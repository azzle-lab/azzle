/** Poster task list from the authoritative Base RPC reader. */

function normAddr(addr) {
  if (!addr || typeof addr !== "string") return "";
  return addr.trim().toLowerCase();
}

export async function getPosterTasks(address, market = "standard") {
  const id = normAddr(address);
  if (!id) throw new Error("Wallet address required");
  const { listV2Tasks } = await import("./tasks-rpc-v2.js");
  return (await listV2Tasks({ limit: 100, poster: id, market })).tasks;
}
