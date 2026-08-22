/** Explicit AZL-only V2 Base RPC reader. No fallback to the legacy manifest. */
import { createPublicClient, http, zeroAddress } from "viem";
import { base } from "viem/chains";
import { rankTask, resolveMetadata, metadataTrust } from "./marketplace-metadata.js";
import { isMarketLive, loadMarketManifest, namespacedTaskId, normalizeMarket } from "./markets.js";

const MAX_SCAN = 5_000;
const BATCH_SIZE = 100;
const STATES = ["NONE", "POSTED", "CLAIMED", "ACTIVE", "DISPUTED", "COMPLETED", "CANCELLED", "RESOLVED"];
const ABI = [
  { type: "function", name: "taskCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "scopeOf", stateMutability: "view", inputs: [{ name: "taskId", type: "uint256" }], outputs: [{ type: "string" }] },
  { type: "function", name: "tasks", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [
    { name: "poster", type: "address" }, { name: "worker", type: "address" },
    { name: "totalAmount", type: "uint256" }, { name: "funded", type: "uint256" },
    { name: "released", type: "uint256" }, { name: "deadline", type: "uint64" },
    { name: "fundingDeadline", type: "uint64" }, { name: "deliveredAt", type: "uint64" },
    { name: "state", type: "uint8" },
  ] },
];

function manifest(market = "standard") {
  return loadMarketManifest(normalizeMarket(market));
}

export async function listV2Tasks({
  limit = 100, state, poster, worker, minAmountAzlWei, cursor,
  taskType, capability, verificationMode, beforeDeadline, metadataUri, market = "standard",
} = {}) {
  const selected = normalizeMarket(market);
  const m = manifest(selected);
  if (!isMarketLive(m)) throw new Error(`${selected} market is not deployed yet`);
  const client = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org") });
  const count = Number(await client.readContract({ address: m.taskRegistry, abi: ABI, functionName: "taskCount" }));
  const first = Math.min(Math.max(Number(limit) || 100, 1), 100);
  const before = cursor ? Number(cursor) : count + 1;
  const minimum = minAmountAzlWei ? BigInt(minAmountAzlWei) : 0n;
  const out = [];
  for (let id = Math.min(count, before - 1); id >= 1 && out.length < first; id--) {
    const row = await client.readContract({ address: m.taskRegistry, abi: ABI, functionName: "tasks", args: [BigInt(id)] });
    const task = {
      protocolVersion: "v2", id: namespacedTaskId(selected, id), localTaskId: String(id), market: selected, asset: "AZL",
      state: STATES[Number(row[8])] ?? "UNKNOWN", poster: row[0], worker: row[1] === zeroAddress ? null : row[1],
      totalAmountAzlWei: row[2].toString(), fundedAzlWei: row[3].toString(), releasedAzlWei: row[4].toString(),
      deadline: Number(row[5]), fundingDeadline: Number(row[6]), deliveredAt: Number(row[7]), registryAddress: m.taskRegistry,
    };
    let scope = null;
    if (m.taskScopeRegistry) {
      try {
        const value = await client.readContract({
          address: m.taskScopeRegistry,
          abi: ABI,
          functionName: "scopeOf",
          args: [BigInt(id)],
        });
        scope = String(value ?? "").trim() || null;
      } catch {
        /* Scope publication is optional; preserve task visibility if unavailable. */
      }
    }
    task.description = scope;
    task.discoveryOpen = Boolean(scope);
    task.discoveryPrivate = !scope;
    task.scopeSource = scope ? "onchain" : null;
    if (metadataUri) task.metadata = await resolveMetadata(metadataUri);
    if (task.metadata) task.metadataTrust = metadataTrust(task.metadata);
    if (state && task.state !== state) continue;
    if (poster && task.poster.toLowerCase() !== String(poster).toLowerCase()) continue;
    if (worker && task.worker?.toLowerCase() !== String(worker).toLowerCase()) continue;
    if (BigInt(task.totalAmountAzlWei) < minimum) continue;
    const score = rankTask(task, { minAmountAzlWei, taskType, capability, verificationMode, beforeDeadline });
    if (score < 0) continue;
    task.matchScore = score;
    out.push(task);
  }
  out.sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0) || Number(b.localTaskId) - Number(a.localTaskId));
  return {
    tasks: out,
    meta: {
      protocolVersion: "v2", asset: "AZL", market: selected, taskCount: count, source: "base-rpc",
      nextCursor: out.length === first ? String(Number(out[out.length - 1].localTaskId)) : null,
    },
  };
}