import { Contract, ethers } from "ethers";
import { AzzleV2Client, checkWorkerPreflight, logPreflightReport } from "@azzle/agents";
import { loadManifest, requireTaskRef } from "./lib/manifest.mjs";
import { loadDotEnv } from "./lib/env.mjs";
import { createDeepSeekRecommender } from "./lib/deepseek.mjs";

loadDotEnv(import.meta.url);

const manifest = loadManifest(import.meta.url);
import { checkTierEligibility, tierForAmountUsdc6, workerBpsSplit } from "./lib/tiers.mjs";
import { runResolutionWatchdog } from "./lib/watchdog.mjs";

const rpcUrl = process.env.AZZLE_RPC_URL ?? "https://mainnet.base.org";

const REPUTATION_ABI = [
  "function arbitratorReputation(address) external view returns (uint256)",
  "function resolvedCount(address) external view returns (uint256)",
];
const ARBITRATION_EVENTS_ABI = [
  "event DisputeOpened(uint256 indexed taskId,address indexed opener,address indexed arbitrator,uint64 evidenceDeadline)",
];
const ARBITRATION_ABI = [
  "function disputes(uint256 taskId) view returns (uint256 taskId,address opener,address arbitrator,bytes32 posterEvidence,bytes32 workerEvidence,uint64 evidenceDeadline,uint64 rulingDeadline,uint8 status,uint8 outcome,uint256 slashed)",
  "function assignArbitrator(uint256 taskId) returns (address)",
  "function beginRuling(uint256 taskId)",
  "function rule(uint256 taskId,uint8 outcome,uint16 workerBps)",
  "function timeout(uint256 taskId)",
];
const AZL_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
];
const BOND_ABI = [
  "function bonds(address verifier) view returns (uint256)",
  "function minimumBond() view returns (uint256)",
  "function bond(uint256 amount)",
];
const GAS_RETRY_MS = 120_000;
const RPC_CALL_TIMEOUT_MS = 30_000;

async function withTimeout(promise, label, timeoutMs = RPC_CALL_TIMEOUT_MS) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

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

function taskRef(localTaskId) {
  return `v2:${manifest.market}:${localTaskId.toString()}`;
}

function matchLocalId(taskId) {
  return String(taskId).match(/^v2:(?:standard|micro):([1-9]\d*)$/)?.[1] ?? "";
}

function disputeView(row) {
  const status = Number(row.status ?? row[7]);
  return {
    taskId: BigInt(row.taskId ?? row[0]),
    opener: row.opener ?? row[1],
    arbitrator: row.arbitrator ?? row[2],
    posterEvidence: row.posterEvidence ?? row[3],
    workerEvidence: row.workerEvidence ?? row[4],
    evidenceDeadline: BigInt(row.evidenceDeadline ?? row[5]),
    rulingDeadline: BigInt(row.rulingDeadline ?? row[6]),
    status,
    statusName: ["NONE", "EVIDENCE", "RULING", "SETTLED"][status] ?? `UNKNOWN(${status})`,
    outcome: Number(row.outcome ?? row[8]),
    slashed: BigInt(row.slashed ?? row[9]),
  };
}

async function autonomousCycle(client, provider, wallet, signer) {
  const latest = await provider.getBlockNumber();
  const fromBlock = Math.max(Number(manifest.deploymentBlock), latest - Number(process.env.AUTONOMOUS_LOOKBACK_BLOCKS ?? 50_000));
  const iface = new ethers.Interface(ARBITRATION_EVENTS_ABI);
  const logs = await provider.getLogs({
    address: manifest.arbitrationModule,
    topics: [iface.getEvent("DisputeOpened").topicHash],
    fromBlock,
    toBlock: latest,
  });
  const discoveredIds = new Set(logs.map((log) => {
    const parsed = iface.parseLog({ topics: log.topics, data: log.data });
    return parsed.args.taskId.toString();
  }));
  const pinnedTask = process.env.AUTONOMOUS_TASK_ID ?? process.env.TASK_ID;
  if (pinnedTask) {
    const match = String(pinnedTask).match(/^v2:(standard|micro):([1-9]\d*)$/);
    if (!match || match[1] !== manifest.market) {
      throw new Error(`AUTONOMOUS_TASK_ID must match v2:${manifest.market}:N`);
    }
    discoveredIds.add(match[2]);
  }
  console.log("[autonomous] cycle check", {
    latestBlock: latest,
    fromBlock,
    disputesFound: logs.length,
    pinnedTask: pinnedTask ?? null,
  });
  const arbitration = new Contract(manifest.arbitrationModule, ARBITRATION_ABI, signer);
  const recommend = createDeepSeekRecommender({ arbitrator: wallet });

  for (const localIdText of discoveredIds) {
    const localId = BigInt(localIdText);
    const id = taskRef(localId);
    console.log("[autonomous] inspecting dispute", id, {
      source: pinnedTask && localIdText === matchLocalId(pinnedTask) ? "pinned task" : "event scan",
    });
    try {
      let dispute = disputeView(await withTimeout(arbitration.disputes(localId), `${id} dispute read`));
      console.log("[autonomous] dispute state", id, {
        status: dispute.statusName,
        assignedArbitrator: dispute.arbitrator,
        isThisWallet: dispute.arbitrator.toLowerCase() === wallet.toLowerCase(),
        evidenceDeadline: dispute.evidenceDeadline.toString(),
        rulingDeadline: dispute.rulingDeadline.toString(),
      });
      if (dispute.statusName === "SETTLED") {
        console.log("[autonomous] dispute already settled", id);
        continue;
      }
      const now = BigInt(Math.floor(Date.now() / 1000));
      const cutoff = dispute.rulingDeadline > 0n
        ? dispute.rulingDeadline
        : dispute.evidenceDeadline + BigInt(manifest.risk.rulingWindow);
      if (now > cutoff) {
        console.log("[autonomous] dispute deadline exceeded; timing out", id);
        const tx = await arbitration.timeout(localId);
        await tx.wait();
        continue;
      }
      if (dispute.arbitrator.toLowerCase() === ethers.ZeroAddress.toLowerCase()) {
        console.log("[autonomous] assigning arbitrator", id);
        const tx = await arbitration.assignArbitrator(localId);
        await tx.wait();
        dispute = disputeView(await arbitration.disputes(localId));
      }
      if (dispute.arbitrator.toLowerCase() !== wallet.toLowerCase()) {
        console.log("[autonomous] case assigned to another panel member", id);
        continue;
      }
      const currentTime = BigInt(Math.floor(Date.now() / 1000));
      if (dispute.statusName === "EVIDENCE" && currentTime > dispute.evidenceDeadline) {
        const tx = await arbitration.beginRuling(localId);
        await tx.wait();
        dispute = disputeView(await arbitration.disputes(localId));
      }
      if (dispute.statusName !== "RULING") continue;
      const [task, scope] = await Promise.all([
        client.getTask(id),
        client.getScope(id).catch(() => ""),
      ]);
      const bundle = {
        taskId: id,
        market: manifest.market,
        state: task.stateName,
        poster: task.poster,
        worker: task.worker,
        totalAmount: task.totalAmount,
        funded: task.funded,
        released: task.released,
        deadline: task.deadline,
        deliveredAt: task.deliveredAt,
        scope,
        parsedScope: undefined,
        dispute,
        xmtpNote: "XMTP is optional; scope and onchain state are the verifiable record.",
      };
      console.log("[autonomous] requesting Bankr/DeepSeek decision", id);
      const decision = await withTimeout(recommend(bundle, null), `${id} Bankr decision`, 120_000);
      console.log("[autonomous] DeepSeek decision", {
        taskId: id,
        intent: decision.intent,
        workerBps: decision.workerBps,
      });
      if (!decision.outcome) {
        console.log("[autonomous] no on-chain settlement; case remains open", id);
        continue;
      }
      const outcome = decision.outcome === "WORKER_WINS" ? 2
        : decision.outcome === "POSTER_WINS" ? 1 : 3;
      const tx = await arbitration.rule(localId, outcome, decision.workerBps);
      await tx.wait();
      console.log("[autonomous] settled", id);
    } catch (error) {
      console.error("[autonomous] case failed; will retry next cycle", id, error);
    }
  }
  if (logs.length === 0) {
    console.log("[autonomous] no newly discovered disputes; next check in configured interval");
  }
}

async function ensureVerifierBond(signer, provider, wallet) {
  const bondVault = new Contract(manifest.verifierBondVault, BOND_ABI, signer);
  const azl = new Contract(manifest.external.azl, AZL_ABI, signer);
  const [bonded, minimumBond, azlBalance, nativeBalance] = await Promise.all([
    bondVault.bonds(wallet),
    bondVault.minimumBond(),
    azl.balanceOf(wallet),
    provider.getBalance(wallet),
  ]);
  console.log("[autonomous] verifier checks", {
    bondedAzlWei: bonded.toString(),
    minimumBondAzlWei: minimumBond.toString(),
    azlBalanceWei: azlBalance.toString(),
    nativeBalanceWei: nativeBalance.toString(),
  });
  if (bonded >= minimumBond) {
    console.log("[autonomous] verifier bond check passed");
    return { ready: true, retryMs: 0 };
  }

  const shortfall = minimumBond - bonded;
  if (azlBalance < shortfall) {
    console.error("[autonomous] verifier bond unavailable: insufficient AZL", {
      currentBondAzlWei: bonded.toString(),
      minimumBondAzlWei: minimumBond.toString(),
      shortfallAzlWei: shortfall.toString(),
      azlBalanceWei: azlBalance.toString(),
      action: "fund this wallet with AZL; retrying in 2 minutes",
    });
    return { ready: false, retryMs: GAS_RETRY_MS };
  }

  const feeData = await provider.getFeeData();
  const gasPrice = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;
  const gasReserve = gasPrice * 500_000n;
  if (nativeBalance < gasReserve) {
    console.error("[autonomous] verifier bond pending: please send ETH for Base gas", {
      nativeBalanceWei: nativeBalance.toString(),
      estimatedReserveWei: gasReserve.toString(),
      action: "fund this wallet with ETH; retrying in 2 minutes",
    });
    return { ready: false, retryMs: GAS_RETRY_MS };
  }

  const allowance = await azl.allowance(wallet, manifest.verifierBondVault);
  if (allowance < shortfall) {
    console.log("[autonomous] approving AZL for verifier bond", shortfall.toString());
    const approval = await azl.approve(manifest.verifierBondVault, minimumBond);
    await approval.wait();
  }
  console.log("[autonomous] depositing verifier bond", shortfall.toString());
  const tx = await bondVault.bond(shortfall);
  await tx.wait();
  console.log("[autonomous] verifier bond ready");
  return { ready: true, retryMs: 0 };
}

async function autonomousFlow() {
  if (String(process.env.AUTONOMOUS_ONCHAIN ?? "").toLowerCase() !== "true") {
    throw new Error("Set AUTONOMOUS_ONCHAIN=true to enable autonomous on-chain actions");
  }
  const signer = requireSigner();
  const provider = signer.provider;
  const wallet = await signer.getAddress();
  const client = connectClient(signer);
  const intervalMs = Math.max(15_000, Number(process.env.AUTONOMOUS_INTERVAL_MS ?? 60_000));
  console.log(`
  __   ____  ____  __    ____                               
 / _\ (__  )(__  )(  )  (  __)                              
/    \ / _/  / _/ / (_/\ ) _)                               
\_/\_/(____)(____)\____/(____)                              

ARBITRATION AGENT
`);
  console.log("[autonomous] running", {
    market: manifest.market,
    model: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
    intervalMs,
    wallet,
  });
  for (;;) {
    let retryMs = intervalMs;
    try {
      const bond = await ensureVerifierBond(signer, provider, wallet);
      if (bond.ready) await autonomousCycle(client, provider, wallet, signer);
      retryMs = bond.retryMs || intervalMs;
    } catch (error) {
      console.error("[autonomous] cycle failed; retrying in 2 minutes", error);
      retryMs = GAS_RETRY_MS;
    }
    await new Promise((resolve) => setTimeout(resolve, retryMs));
  }
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
  if (cmd === "autonomous") {
    await autonomousFlow();
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
  console.log("  node agent.mjs autonomous          # DeepSeek continuous arbitrator (requires AUTONOMOUS_ONCHAIN=true)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
