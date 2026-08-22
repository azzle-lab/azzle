/** Poster task list via the canonical dual-market V2 Base RPC reader. */
import { listV2Tasks } from "../api/lib/tasks-rpc-v2.js";
import { normalizeMarket } from "../api/lib/markets.js";

export async function getPosterTasks(address, market = "standard") {
  const id = String(address ?? "").trim().toLowerCase();
  if (!id) throw new Error("Wallet address required");
  return (await listV2Tasks({ limit: 100, poster: id, market: normalizeMarket(market) })).tasks;
}
