import { ethers } from "ethers";
import {
  AzzleV2Client,
  RpcDiscovery,
  checkWorkerPreflight,
  logPreflightReport,
} from "@azzle/agents";
import { loadManifest } from "./lib/manifest.mjs";
import { loadDotEnv } from "./lib/env.mjs";

loadDotEnv(import.meta.url);

const manifest = loadManifest(import.meta.url, "base-8453.json");
import { warnIfBelowFloor } from "./lib/solvency.mjs";

const rpcUrl = process.env.AZZLE_RPC_URL ?? "https://mainnet.base.org";

const TASK_STATE = { ACTIVE: 3 };

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wait until full poster funding transitions the claimed task to ACTIVE. */
async function waitForActive(client, taskId, options = {}) {
  const timeoutMs = options.timeoutMs ?? Number(process.env.WORKER_FUND_TIMEOUT_MS ?? 600_000);
  const pollMs = options.pollMs ?? 3_000;
  const deadline = Date.now() + timeoutMs;
  let announced = false;

  for (;;) {
    const state = await client.taskState(taskId);
    if (state === TASK_STATE.ACTIVE) {
      console.log("[worker] task ACTIVE", { taskId: taskId.toString() });
      return true;
    }
    if (!announced) {
      announced = true;
      console.log(
        `[worker] waiting for full poster funding to transition task ${taskId} to ACTIVE ` +
          `(state ${state}) — timeout ${Math.round(timeoutMs / 1000)}s`
      );
    }
    if (Date.now() >= deadline) {
      console.error(
        `[worker] task ${taskId} did not become ACTIVE within ${Math.round(timeoutMs / 1000)}s — ` +
          "ask the poster to fully fund escrow, then retry delivery"
      );
      return false;
    }
    await sleep(pollMs);
  }
}

function requireSigner() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("Set PRIVATE_KEY in .env");
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  return new ethers.Wallet(pk, provider);
}

function connectClient(signer) {
  return new AzzleV2Client(manifest, rpcUrl).connect(signer);
}

async function runPreflight() {
  const signer = requireSigner();
  const wallet = await signer.getAddress();
  const report = await checkWorkerPreflight(signer.provider, wallet, {
    agentDepositVault: manifest.depositVault,
    azlToken: manifest.external.azl,
  });
  logPreflightReport(report);
  await warnIfBelowFloor(signer.provider, wallet);
}

async function listOpen() {
  const indexer = new RpcDiscovery({ rpcUrl: process.env.AZZLE_RPC_URL ?? "https://mainnet.base.org" });
  const tasks = await indexer.getOpenTasks();
  console.log(JSON.stringify({ count: tasks.length, tasks }, null, 2));
}

async function claimFlow(taskIdArg) {
  const taskId = BigInt(taskIdArg ?? process.env.TASK_ID ?? "0");
  if (taskId === 0n) throw new Error("Usage: npm run claim -- <taskId> or set TASK_ID");

  const signer = requireSigner();
  const wallet = await signer.getAddress();
  const client = connectClient(signer);

  await runPreflightChecks(signer, wallet);
  await warnIfBelowFloor(signer.provider, wallet);

  const { createNegotiationLayer } = await import("./lib/xmtp-setup.mjs");
  const { transport } = await createNegotiationLayer(signer);
  transport.subscribe?.((msg) => console.log("[xmtp] envelope", msg.type, msg.taskId));

  console.log("[worker] claiming task", taskId.toString());
  const claimTx = await client.claim(taskId);
  await claimTx.wait();

  return markDeliveredFlow(client, taskId);
}

async function markDeliveredFlow(client, taskId) {
  const ready = await waitForActive(client, taskId);
  if (!ready) return null;

  console.log("[worker] marking task delivered", taskId.toString());
  const tx = await client.markDelivered(taskId);
  await tx.wait();
  console.log("[worker] delivery recorded; await poster release or completion");
  return taskId;
}

async function deliverFlow(taskIdArg) {
  const taskId = BigInt(taskIdArg ?? process.env.TASK_ID ?? "0");
  if (taskId === 0n) throw new Error("Usage: node agent.mjs deliver <taskId>");
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
  if (cmd === "claim") {
    await claimFlow(process.argv[3]);
    return;
  }
  if (cmd === "deliver") {
    await deliverFlow(process.argv[3]);
    return;
  }

  console.log(`AZZLE worker agent (Base ${manifest.chainId})`);
  console.log("");
  console.log("Commands:");
  console.log("  npm run preflight   # AZL deposit and wallet balance checks");
  console.log("  npm run list-open   # POSTED tasks from Base RPC");
  console.log("  npm run claim -- <taskId>");
  console.log("  node agent.mjs deliver <taskId>  # wait ACTIVE, then markDelivered");
  console.log("");
  console.log("Flow: claim → wait ACTIVE after full funding → markDelivered → poster release / complete");
  console.log("Set USE_XMTP_LIVE=true for XmtpNegotiationTransport (default: NegotiationBus)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
