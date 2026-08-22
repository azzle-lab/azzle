/**
 * Reference poster agent — funds escrow, monitors delivery, and completes tasks.
 * Uses NegotiationBus locally; use startAgent() from ../sdk/xmtp for production XMTP.
 */
import { NegotiationBus } from "../sdk/xmtp-local-bus.js";
import { buildSettlementDigest } from "../sdk/settlement.js";
import { buildEnvelope } from "../sdk/xmtp/envelope.js";
import type { TaskTerms } from "../sdk/types.js";
import { loadBaseMainnetV2Manifest, type BaseMainnetV2Manifest } from "../sdk/manifest-v2.js";
import { resolveExpectedMarket } from "../sdk/markets.js";

export async function runPosterAgent(
  terms: TaskTerms,
  manifest: BaseMainnetV2Manifest = loadBaseMainnetV2Manifest()
) {
  if (!process.env.AZZLE_MARKET) throw new Error("Reference poster requires AZZLE_MARKET=standard or micro");
  const market = resolveExpectedMarket(process.env.AZZLE_MARKET, manifest);
  const bus = new NegotiationBus();
  const negotiationId = bus.createNegotiation();
  const digest = buildSettlementDigest(terms);

  await bus.send(
    buildEnvelope({
      type: "TaskProposal",
      negotiationId,
      market,
      sequence: 1,
      sender: {
        evmAddress: terms.poster.toLowerCase(),
        xmtpPublicKey: "0x" + "01".repeat(32),
      },
      payload: {
        type: "azzle/TaskProposal",
        task: {
          schemaVersion: "azzle-task-v2",
          taskType: "software.implementation",
          title: "Reference task",
          acceptanceCriteria: {
            mode: "deterministic",
            specHash: terms.acceptanceCriteriaHash,
          },
          compensation: {
            amount: terms.totalAmount.toString(),
            token: manifest.external.azl,
            mode: "fixed_total",
            decimals: 18,
          },
        },
        settlementDigestPreview: digest,
      },
    })
  );

  console.log("[poster-agent] proposal sent", { negotiationId, market, digest });
  return { negotiationId, digest };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPosterAgent({
    poster: "0x0000000000000000000000000000000000000001",
    worker: "0x0000000000000000000000000000000000000002",
    totalAmount: 1000000n,
    deadline: Math.floor(Date.now() / 1000) + 86400,
    acceptanceCriteriaHash: "0x" + "00".repeat(32),
    chainId: 8453n,
    registryAddress: "0x0000000000000000000000000000000000000004",
  }).catch(console.error);
}
