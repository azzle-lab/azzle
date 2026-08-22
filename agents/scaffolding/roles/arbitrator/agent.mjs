import { Contract, ethers } from "ethers";
import { AzzleV2Client, checkWorkerPreflight, logPreflightReport } from "@azzle/agents";
import { loadManifest, requireTaskRef } from "./lib/manifest.mjs";
import { loadDotEnv } from "./lib/env.mjs";

loadDotEnv(import.meta.url);

const manifest = loadManifest(import.meta.url, "base-8453.json");
import { checkTierEligibility, tierForAmountUsdc6, workerBpsSplit } from "./lib/tiers.mjs";
import { runResolutionWatchdog } from "./lib/watchdog.mjs";

const rpcUrl = process.env.AZZLE_RPC_URL ?? "https://mainnet.base.org";

const REPUTATION_ABI = [
  "function arbitratorReputation(address) external view returns (uint256)",
  "function resolvedCount(address) external view returns (uint256)",
];

function requireSigner() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("Set PRIVATE_KEY in .env");
  return new ethers.Wallet(pk, new ethers.JsonRpcProvider(rpcUrl));
}

function connectClient(signer) {
  return new AzzleV2Client(manifest, rpcUrl, process.env.AZZLE_MARKET).connect(signer);
}

async function readArbitratorStats(provider, wallet) {
  const rep = new Contract(manifest.reputationRegistry, REPUTATION_ABI, provider);
  const [arbitratorRep, resolvedCount] = await Promise.all([
    rep.arbitratorReputation(wallet),
    rep.resolvedCount(wallet),
  ]);
  return { rep: Number(arbitratorRep), resolvedCount: Number(resolvedCount) };
}

async function runPreflight() {
  const signer = requireSigner();
  const wallet = await signer.getAddress();
  const report = await checkWorkerPreflight(signer.provider, wallet, {
    agentDepositVault: manifest.depositVault,
    azlToken: manifest.external.azl,
  });
  logPreflightReport(report);
  const stats = await readArbitratorStats(signer.provider, wallet);
  console.log("[arbitrator] reputation", stats);
  for (const tier of [0, 1, 2]) {
    const { eligible, reasons, gate } = checkTierEligibility(tier, {
      rep: stats.rep,
      resolvedCount: stats.resolvedCount,
      hasDeposit: report.vaultOk,
    });
    console.log(`[arbitrator] ${gate.label}:`, eligible ? "eligible" : reasons.join("; "));
  }
}

async function assignArbitrator(taskIdArg) {
  const taskId = requireTaskRef(taskIdArg ?? process.env.TASK_ID);

  const client = connectClient(requireSigner());
  console.log("[arbitrator] assigning a bonded panel member", taskId.toString());
  const tx = await client.assignArbitrator(taskId);
  await tx.wait();
}

async function ruleFlow(taskIdArg, workerPercentArg) {
  const taskId = requireTaskRef(taskIdArg ?? process.env.TASK_ID);
  const workerPercent = Number(workerPercentArg ?? process.env.WORKER_PERCENT ?? "50");
  const outcome = Number(process.env.DISPUTE_OUTCOME ?? "3");
  if (!Number.isInteger(outcome) || outcome < 1 || outcome > 4) {
    throw new Error("DISPUTE_OUTCOME must be a V2 outcome from 1 to 4");
  }

  const client = connectClient(requireSigner());
  const workerBps = workerBpsSplit(workerPercent);
  console.log("[arbitrator] ruling on V2 dispute", { taskId: taskId.toString(), outcome, workerBps });
  const tx = await client.rule(taskId, outcome, workerBps);
  await tx.wait();
}

async function watchdogFlow(taskIdArg) {
  const taskId = requireTaskRef(taskIdArg ?? process.env.TASK_ID);
  const signer = requireSigner();
  const client = connectClient(signer);
  await runResolutionWatchdog(client, signer.provider, manifest, taskId);
}

async function tierCheck(amountArg) {
  const amount = BigInt(amountArg ?? "50000000");
  const tier = tierForAmountUsdc6(amount);
  const signer = requireSigner();
  const wallet = await signer.getAddress();
  const stats = await readArbitratorStats(signer.provider, wallet);
  const report = await checkWorkerPreflight(signer.provider, wallet, {
    agentDepositVault: manifest.depositVault,
    azlToken: manifest.external.azl,
  });
  const result = checkTierEligibility(tier, {
    rep: stats.rep,
    resolvedCount: stats.resolvedCount,
    hasDeposit: report.vaultOk,
  });
  console.log("[arbitrator] tier check", { tier, amount: amount.toString(), ...result });
}

async function main() {
  const cmd = process.argv[2] ?? "help";
  const a = process.argv[3];
  const b = process.argv[4];

  if (cmd === "preflight") {
    await runPreflight();
    return;
  }
  if (cmd === "assign") {
    await assignArbitrator(a);
    return;
  }
  if (cmd === "rule") {
    await ruleFlow(a, b);
    return;
  }
  if (cmd === "watchdog") {
    await watchdogFlow(a);
    return;
  }
  if (cmd === "tier-check") {
    await tierCheck(a);
    return;
  }

  console.log(`AZZLE arbitrator agent (Base ${manifest.chainId})`);
  console.log("");
  console.log("Commands:");
  console.log("  npm run preflight              # deposit + tier eligibility");
  console.log("  node agent.mjs assign <v2:market:N> # permissionless capacity fallback");
  console.log("  node agent.mjs rule <v2:market:N> [workerPercent] # set DISPUTE_OUTCOME=1..4");
  console.log("  npm run watchdog -- <v2:market:N>   # calls V2 timeout after deadlines");
  console.log("  node agent.mjs tier-check [amountUsd6]");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
