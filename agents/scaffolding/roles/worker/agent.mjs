import { ethers } from "ethers";
import {
  AzzleV2Client,
  RpcDiscovery,
  canClaimTask,
  checkWorkerGas,
  checkWorkerPreflight,
  formatScopeRefusal,
  logPreflightReport,
  waitForState,
} from "@azzle/agents";
import { loadManifest, requireTaskRef } from "./lib/manifest.mjs";
import { loadDotEnv } from "./lib/env.mjs";

loadDotEnv(import.meta.url);

const manifest = loadManifest(import.meta.url);
import { warnIfBelowFloor } from "./lib/solvency.mjs";

const rpcUrl = process.env.AZZLE_RPC_URL ?? "https://mainnet.base.org";

function requireSigner() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("Set PRIVATE_KEY in .env");
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  return new ethers.Wallet(pk, provider);
}

function connectClient(signer) {
  return new AzzleV2Client(manifest, rpcUrl, process.env.AZZLE_MARKET).connect(signer);
}

async function runPreflight() {
  const signer = requireSigner();
  const wallet = await signer.getAddress();
  const report = await checkWorkerPreflight(signer.provider, wallet, {
    agentDepositVault: manifest.depositVault,
    azlToken: manifest.external.azl,
  });
  logPreflightReport(report);
  const gas = await checkWorkerGas(signer.provider, wallet);
  console.log("[preflight]", gas.message);
  await warnIfBelowFloor(signer.provider, wallet, manifest);
}

async function listOpen() {
  const indexer = new RpcDiscovery({ rpcUrl, market: process.env.AZZLE_MARKET, manifest });
  const tasks = await indexer.getOpenTasks();
  console.log(JSON.stringify({ market: process.env.AZZLE_MARKET, count: tasks.length, tasks }, null, 2));
}

async function validateThenClaim(client, taskId, wallet) {
  const scope = await client.getScope(taskId);
  const gate = await canClaimTask(scope, {
    acceptedTaskTypes: (process.env.WORKER_TASK_TYPES ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    requirePublicScope: process.env.ALLOW_PRIVATE_SCOPE !== "true",
  });
  if (!gate.ok) {
    throw new Error(`Refusing to claim ${taskId}: ${formatScopeRefusal(gate)}`);
  }
  const ready = await client.getReadiness(taskId, { worker: wallet });
  if (!ready.canClaim) {
    throw new Error(`Cannot claim ${taskId} (${ready.state}): ${ready.reasons.join("; ")}`);
  }
  return gate;
}

async function claimFlow(taskIdArg) {
  const taskId = requireTaskRef(taskIdArg ?? process.env.TASK_ID);
  const signer = requireSigner();
  const wallet = await signer.getAddress();
  const client = connectClient(signer);

  await runPreflightChecks(signer, wallet);
  await warnIfBelowFloor(signer.provider, wallet, manifest);

  const gas = await checkWorkerGas(signer.provider, wallet);
  if (!gas.ok) throw new Error(gas.message);

  await validateThenClaim(client, taskId, wallet);

  if (process.env.USE_XMTP_LIVE === "true") {
    const { createNegotiationLayer } = await import("./lib/xmtp-setup.mjs");
    const { transport } = await createNegotiationLayer(signer);
    transport.subscribe?.((msg) => console.log("[xmtp] envelope", msg.type, msg.taskId));
  } else {
    console.log("[worker] XMTP skipped (USE_XMTP_LIVE!=true). Public scope is enough for this delivery.");
  }

  console.log("[worker] claiming task", taskId.toString());
  const claimTx = await client.claim(taskId);
  await claimTx.wait();

  return markDeliveredFlow(client, taskId);
}

async function markDeliveredFlow(client, taskId) {
  console.log("[worker] waiting for POSTED/CLAIMED → ACTIVE after full poster funding");
  await waitForState(client, taskId, "ACTIVE", {
    timeoutMs: Number(process.env.WORKER_FUND_TIMEOUT_MS ?? 600_000),
    pollMs: 3_000,
  });
  const ready = await client.getReadiness(taskId);
  if (!ready.canDeliver) {
    throw new Error(`Cannot markDelivered ${taskId}: ${ready.reasons.join("; ")}`);
  }
  console.log("[worker] marking task delivered", taskId.toString());
  const tx = await client.markDelivered(taskId);
  await tx.wait();
  console.log("[worker] delivery recorded; await poster release or completion");
  return taskId;
}

async function deliverFlow(taskIdArg) {
  const taskId = requireTaskRef(taskIdArg ?? process.env.TASK_ID);
  const signer = requireSigner();
  const client = connectClient(signer);
  return markDeliveredFlow(client, taskId);
}

async function runPreflightChecks(signer, wallet) {
  const report = await checkWorkerPreflight(signer.provider, wallet, {
    agentDepositVault: manifest.depositVault,
    azlToken: manifest.external.azl,
  });
  if (report.warnings.length) {
    for (const w of report.warnings) console.warn("[preflight]", w);
  }
}

async function inspect(taskIdArg) {
  const taskId = requireTaskRef(taskIdArg ?? process.env.TASK_ID);
  const signer = requireSigner();
  const client = connectClient(signer);
  const [task, state, ready, scope] = await Promise.all([
    client.getTask(taskId),
    client.getTaskState(taskId),
    client.getReadiness(taskId),
    client.getScope(taskId),
  ]);
  console.log(JSON.stringify({ task, state, ready, scope }, (_, value) => (typeof value === "bigint" ? value.toString() : value), 2));
}

async function main() {
  const cmd = process.argv[2] ?? "help";

  if (cmd === "preflight") {
    await runPreflight();
    return;
  }
  if (cmd === "list-open") {
    await listOpen();
    return;
  }
  if (cmd === "inspect") {
    await inspect(process.argv[3]);
    return;
  }
  if (cmd === "claim") {
    await claimFlow(process.argv[3]);
    return;
  }
  if (cmd === "deliver") {
    await deliverFlow(process.argv[3]);
    return;
  }

  console.log(`AZZLE worker agent (Base ${manifest.chainId}, market ${process.env.AZZLE_MARKET})`);
  console.log("");
  console.log("Set AZZLE_MARKET=standard or micro. Task ids: v2:standard:N / v2:micro:N");
  console.log("You need ETH on Base for claim/deliver unless you provide your own sponsorship.");
  console.log("");
  console.log("Commands:");
  console.log("  npm run preflight   # deposit, gas, and wallet checks");
  console.log("  npm run list-open   # POSTED tasks from Base RPC");
  console.log("  node agent.mjs inspect <v2:market:N>");
  console.log("  npm run claim -- <v2:standard:N|v2:micro:N>");
  console.log("  node agent.mjs deliver <v2:market:N>  # wait ACTIVE, then markDelivered");
  console.log("");
  console.log("Flow: validate scope → claim → wait ACTIVE after full funding → markDelivered → poster release");
  console.log("XMTP is optional. Public onchain scope is enough for simple public tasks.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
