import { ethers } from "ethers";
import { AzzleV2Client, checkWorkerPreflight, logPreflightReport } from "@azzle/agents";
import { loadManifest, requireTaskRef } from "./lib/manifest.mjs";
import { loadDotEnv } from "./lib/env.mjs";

loadDotEnv(import.meta.url);

const manifest = loadManifest(import.meta.url, "base-8453.json");
import { runApprovalScaffold } from "./lib/approvals.mjs";
import { fundTaskEscrow, openDispute, release, waitForWorkerClaim } from "./lib/escrow.mjs";

const rpcUrl = process.env.AZZLE_RPC_URL ?? "https://mainnet.base.org";

function requireSigner() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("Set PRIVATE_KEY in .env");
  return new ethers.Wallet(pk, new ethers.JsonRpcProvider(rpcUrl));
}

function connectClient(signer) {
  return new AzzleV2Client(manifest, rpcUrl, process.env.AZZLE_MARKET).connect(signer);
}

function sampleTerms() {
  return {
    totalAmount: 50_000_000_000_000_000_000n, // 50 AZL
    deadline: BigInt(Math.floor(Date.now() / 1000) + 7 * 86400),
  };
}

async function runPreflight() {
  const signer = requireSigner();
  const wallet = await signer.getAddress();
  await runApprovalScaffold(connectClient(signer));
  const report = await checkWorkerPreflight(signer.provider, wallet, {
    agentDepositVault: manifest.depositVault,
    azlToken: manifest.external.azl,
  });
  logPreflightReport(report);
}

async function postTaskFlow() {
  const signer = requireSigner();
  const client = connectClient(signer);
  await runApprovalScaffold(client);

  const terms = sampleTerms();
  console.log("[poster] posting public V2 market task");
  const result = await client.post(terms.totalAmount, Number(terms.deadline));

  console.log("[poster] task created", { taskId: result.taskId.toString() });

  const claimed = await waitForWorkerClaim(client, result.taskId);
  if (claimed) await fundTaskEscrow(client, signer, manifest, result.taskId, terms.totalAmount);

  console.log("[poster] full funding transitions a CLAIMED V2 task to ACTIVE automatically");
  console.log("[poster] release(taskId, amountAzlWei) pays the worker; disputes freeze unreleased escrow");

  return result;
}

async function fundOnly(taskIdArg) {
  const taskId = requireTaskRef(taskIdArg ?? process.env.TASK_ID);
  const signer = requireSigner();
  const client = connectClient(signer);
  const amount = BigInt(process.env.FUND_AMOUNT ?? "50000000");
  const claimed = await waitForWorkerClaim(client, taskId);
  if (!claimed) return;
  await fundTaskEscrow(client, signer, manifest, taskId, amount);
  const task = await client.getTask(taskId);
  if (task.worker !== ethers.ZeroAddress && task.state === 2) {
    console.log("[poster] task is CLAIMED; full funding transitions it to ACTIVE automatically");
  }
}

async function releaseOnly(taskIdArg, amountArg) {
  const taskId = requireTaskRef(taskIdArg ?? process.env.TASK_ID);
  const amountAzlWei = BigInt(amountArg ?? process.env.RELEASE_AMOUNT ?? "0");
  if (amountAzlWei <= 0n) {
    throw new Error("Usage: node agent.mjs release <taskId> <positiveAmountAzlWei>");
  }
  await release(connectClient(requireSigner()), taskId, amountAzlWei);
}

async function main() {
  const cmd = process.argv[2] ?? "help";
  const sub = process.argv[3];

  if (cmd === "preflight") {
    await runPreflight();
    return;
  }
  if (cmd === "post") {
    await postTaskFlow();
    return;
  }
  if (cmd === "fund") {
    await fundOnly(sub);
    return;
  }
  if (cmd === "release") {
    await releaseOnly(sub, process.argv[4]);
    return;
  }
  if (cmd === "dispute") {
    const taskId = requireTaskRef(sub ?? process.env.TASK_ID);
    const client = connectClient(requireSigner());
    await openDispute(client, taskId, process.env.EVIDENCE_HASH ?? ethers.id("dispute-evidence"));
    return;
  }

  console.log(`AZZLE poster agent (Base ${manifest.chainId})`);
  console.log("");
  console.log("Commands:");
  console.log("  npm run preflight          # AZL approval + gateway deposit checklist");
  console.log("  npm run post               # post → wait for claim → fund");
  console.log("  npm run fund -- <v2:standard:N|v2:micro:N>");
  console.log("  node agent.mjs release <v2:market:N> <positiveAmountAzlWei>");
  console.log("  node agent.mjs dispute <v2:market:N>");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
