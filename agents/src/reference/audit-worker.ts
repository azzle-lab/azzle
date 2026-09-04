/**
 * End-to-end audit worker template from the LoneStarOracle pilot:
 * discover → validate scope → claim → wait ACTIVE → execute → hash receipt →
 * publish artifact → markDelivered.
 *
 * XMTP is optional. Public onchain scope is enough for simple audit tasks.
 */
import { ethers } from "ethers";
import { AzzleV2Client } from "../sdk/client-v2.js";
import {
  buildExecutionReceipt,
  hashDeliverable,
  planDelivery,
} from "../sdk/index.js";
import { loadMarketManifest, type AzzleMarket } from "../sdk/markets.js";
import { checkWorkerGas } from "../sdk/onboarding.js";
import { checkWorkerPreflight, logPreflightReport } from "../sdk/preflight.js";
import { RpcDiscovery } from "../sdk/rpc-discovery.js";
import { canClaimTask, formatScopeRefusal } from "../sdk/scope.js";

export interface AuditWorkerConfig {
  market: AzzleMarket;
  rpcUrl: string;
  signer: ethers.Signer;
  /** Replace with RattlerAI / Cottonmouth / your engine. */
  audit: (scope: string) => Promise<{ report: string; mime?: string; hostedUrl?: string }>;
  acceptedTaskTypes?: string[];
}

export async function runAuditWorkerOnce(config: AuditWorkerConfig, taskId?: string) {
  const manifest = loadMarketManifest(config.market);
  const wallet = await config.signer.getAddress();
  const client = new AzzleV2Client(manifest, config.rpcUrl, config.market).connect(config.signer);
  const gas = await checkWorkerGas(config.signer.provider!, wallet);
  if (!gas.ok) throw new Error(gas.message);
  const preflight = await checkWorkerPreflight(config.signer.provider!, wallet, {
    agentDepositVault: manifest.depositVault,
    azlToken: manifest.external.azl,
  });
  logPreflightReport(preflight);

  const discovery = new RpcDiscovery({ rpcUrl: config.rpcUrl, market: config.market, manifest });
  const open = taskId
    ? [{ id: taskId }]
    : await discovery.getOpenTasks();

  for (const row of open) {
    const id = row.id;
    const scope = await client.getScope(id);
    const gate = await canClaimTask(scope, {
      acceptedTaskTypes: config.acceptedTaskTypes ?? ["solidity-audit", "audit"],
    });
    if (!gate.ok) {
      console.warn("[audit-worker] refuse", id, formatScopeRefusal(gate));
      continue;
    }

    const ready = await client.getReadiness(id, { worker: wallet });
    if (!ready.canClaim) {
      console.warn("[audit-worker] cannot claim", id, ready.reasons);
      continue;
    }

    const claimTx = await client.claim(id);
    await claimTx.wait();
    await client.waitForState(id, "ACTIVE");

    const { report, mime, hostedUrl } = await config.audit(scope);
    const contentHash = hashDeliverable(report);
    const delivery = planDelivery({ content: report, hostedUrl, mime });
    const receipt = buildExecutionReceipt({
      taskId: id,
      worker: wallet,
      artifacts: [{ type: "audit-report", hash: contentHash, uri: delivery.artifactUrl }],
      availability: {
        retrievalUri: delivery.artifactUrl,
        verifiedAt: new Date().toISOString(),
        contentAddressed: true,
      },
    });

    const deliverable = await client.getReadiness(id, { worker: wallet });
    if (!deliverable.canDeliver) {
      throw new Error(`Cannot markDelivered ${id}: ${deliverable.reasons.join("; ")}`);
    }
    const tx = await client.markDelivered(id);
    await tx.wait();
    return { taskId: id, receipt, delivery, refused: false as const };
  }
  return { refused: true as const };
}
