/** Task detail — authoritative onchain read. */
import { createPublicClient, formatUnits, http, zeroAddress } from "viem";
import { base } from "viem/chains";
import { isMarketLive, loadMarketManifest, normalizeMarket, parseTaskRef } from "./markets.js";

const RPC_URL = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";

const TASK_STATE = [
  "NONE",
  "POSTED",
  "CLAIMED",
  "ACTIVE",
  "DISPUTED",
  "COMPLETED",
  "CANCELLED",
  "RESOLVED",
];

const REGISTRY_ABI = [
  {
    type: "function",
    name: "tasks",
    stateMutability: "view",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "poster", type: "address" },
          { name: "worker", type: "address" },
          { name: "totalAmount", type: "uint256" },
          { name: "funded", type: "uint256" },
          { name: "released", type: "uint256" },
          { name: "deadline", type: "uint64" },
          { name: "fundingDeadline", type: "uint64" },
          { name: "deliveredAt", type: "uint64" },
          { name: "state", type: "uint8" },
        ],
      },
    ],
  },
];

const ESCROW_ABI = [
  {
    type: "function",
    name: "escrows",
    stateMutability: "view",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [{
      type: "tuple",
      components: [
        { name: "poster", type: "address" },
        { name: "worker", type: "address" },
        { name: "deposited", type: "uint256" },
        { name: "released", type: "uint256" },
        { name: "state", type: "uint8" },
      ],
    }],
  },
];

const ARBITRATION_ABI = [
  {
    type: "function",
    name: "disputes",
    stateMutability: "view",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "taskId", type: "uint256" },
          { name: "opener", type: "address" },
          { name: "arbitrator", type: "address" },
          { name: "posterEvidence", type: "bytes32" },
          { name: "workerEvidence", type: "bytes32" },
          { name: "evidenceDeadline", type: "uint64" },
          { name: "rulingDeadline", type: "uint64" },
          { name: "status", type: "uint8" },
          { name: "outcome", type: "uint8" },
          { name: "slashed", type: "uint256" },
        ],
      },
    ],
  },
];

const DISPUTE_STATUS = ["NONE", "EVIDENCE", "RULING", "SETTLED"];
const DISPUTE_OUTCOME = ["NONE", "POSTER_WINS", "WORKER_WINS", "SPLIT", "MUTUAL"];

function getClient() {
  if (!client) {
    client = createPublicClient({ chain: base, transport: http(RPC_URL) });
  }
  return client;
}

export async function getTaskDetail(taskIdRaw, expectedMarket) {
  const ref = parseTaskRef(taskIdRaw);
  if (expectedMarket != null && ref.market !== normalizeMarket(expectedMarket)) {
    throw new Error("Task id market does not match selected market");
  }
  const m = loadMarketManifest(ref.market);
  if (!isMarketLive(m)) return null;
  const taskId = ref.localId;
  const id = BigInt(taskId);

  const [task, locked] = await Promise.all([
    getClient().readContract({
      address: m.taskRegistry,
      abi: REGISTRY_ABI,
      functionName: "tasks",
      args: [id],
    }),
    getClient().readContract({
      address: m.escrowVault,
      abi: ESCROW_ABI,
      functionName: "escrows",
      args: [id],
    }),
  ]);

  if (!task?.poster || task.poster === zeroAddress) {
    return null;
  }

  const stateIndex = Number(task.state);
  const state = TASK_STATE[stateIndex] ?? "UNKNOWN";
  const totalAmount = task.totalAmount;
  const fundedWei = task.funded;
  const releasedWei = task.released;
  const lockedWei = fundedWei > releasedWei ? fundedWei - releasedWei : 0n;
  const escrowLocked = locked?.deposited > locked?.released
    ? locked.deposited - locked.released
    : 0n;
  // Registry funded − released is the job lock. Escrow is only a fallback if
  // the registry row has not been funded yet but the vault already holds AZL.
  const lockedBal = lockedWei > 0n ? lockedWei : escrowLocked;
  const budgetAzl = Number(formatUnits(totalAmount, 18));
  const lockedAzl = Number(formatUnits(lockedBal, 18));
  const poster = task.poster;
  const worker =
    task.worker !== zeroAddress
        ? task.worker
        : null;

  let onchainScope = null;
  try {
    const { readOnchainTaskScope } = await import("./task-scope.js");
    onchainScope = await readOnchainTaskScope(taskId, m.taskScopeRegistry, ref.market);
  } catch {
    /* scope registry optional */
  }

  const fullyFunded = fundedWei >= totalAmount && totalAmount > 0n;
  const delivered = Number(task.deliveredAt) > 0;
  const now = Math.floor(Date.now() / 1000);
  const canClaim = state === "POSTED";
  const canFund = state === "CLAIMED" || (state === "ACTIVE" && !fullyFunded);
  const canDeliver = state === "ACTIVE" && fullyFunded && !delivered;

  let dispute = null;
  if (state === "DISPUTED" && m.arbitrationModule) {
    try {
      const row = await getClient().readContract({
        address: m.arbitrationModule,
        abi: ARBITRATION_ABI,
        functionName: "disputes",
        args: [id],
      });
      const status = Number(row.status);
      const outcome = Number(row.outcome);
      dispute = {
        opener: row.opener,
        arbitrator: row.arbitrator,
        posterEvidence: row.posterEvidence,
        workerEvidence: row.workerEvidence,
        evidenceDeadline: Number(row.evidenceDeadline),
        rulingDeadline: Number(row.rulingDeadline),
        status,
        statusName: DISPUTE_STATUS[status] ?? "UNKNOWN",
        outcome,
        outcomeName: DISPUTE_OUTCOME[outcome] ?? "UNKNOWN",
        urgent: Number(row.rulingDeadline || row.evidenceDeadline) > 0 && Number(row.rulingDeadline || row.evidenceDeadline) <= now + 3600,
      };
    } catch {
      dispute = null;
    }
  }
  const description = onchainScope;
  const discoveryOpen = Boolean(onchainScope);
  const discoveryPrivate = !onchainScope;

  return {
    id: ref.id,
    protocolVersion: "v2",
    market: ref.market,
    asset: "AZL",
    state,
    budgetAzl,
    totalAmountAzlWei: totalAmount.toString(),
    fundedAzlWei: fundedWei.toString(),
    releasedAzlWei: releasedWei.toString(),
    lockedAzlWei: lockedBal.toString(),
    lockedAzl,
    funded: fundedWei >= totalAmount && totalAmount > 0n,
    escrowAmount: totalAmount.toString(),
    deadline: Number(task.deadline),
    createdAt: null,
    updatedAt: Number(task.deliveredAt),
    fundingDeadline: Number(task.fundingDeadline),
    deliveredAt: Number(task.deliveredAt),
    poster,
    worker,
    description,
    discoveryOpen,
    discoveryPrivate,
    scopeSource: onchainScope ? "onchain" : null,
    listingBudgetAzl: null,
    listingDeadlineDays: null,
    listingSavedAt: null,
    escrowMode: null,
    claimable: canClaim,
    canClaim,
    canFund,
    canDeliver,
    dispute,
    registryAddress: m.taskRegistry,
    escrowAddress: m.escrowVault,
    chainId: Number(m.chainId),
  };
}
