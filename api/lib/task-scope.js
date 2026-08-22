/** Read onchain task scope from TaskScopeRegistry (Base). */
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { normalizeMarket, requireLiveMarket } from "./markets.js";

const RPC_URL = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";

const SCOPE_ABI = [
  {
    type: "function",
    name: "scopeOf",
    stateMutability: "view",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [{ type: "string" }],
  },
];

export function taskScopeRegistryAddress(registry, market) {
  const selected = normalizeMarket(market);
  const expected = requireLiveMarket(selected).manifest.taskScopeRegistry?.trim() || null;
  if (registry?.trim() && registry.trim().toLowerCase() !== expected?.toLowerCase()) {
    throw new Error(`Scope registry does not belong to the selected ${selected} graph`);
  }
  return expected;
}

export async function readOnchainTaskScope(taskId, registryAddress, market) {
  const registry = taskScopeRegistryAddress(registryAddress, market);
  if (!registry) return null;

  try {
    const client = createPublicClient({ chain: base, transport: http(RPC_URL) });
    const scope = await client.readContract({
      address: registry,
      abi: SCOPE_ABI,
      functionName: "scopeOf",
      args: [BigInt(taskId)],
    });
    const text = String(scope ?? "").trim();
    return text || null;
  } catch {
    return null;
  }
}
