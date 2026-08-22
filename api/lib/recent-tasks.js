export async function getRecentTasks(limit = 50, market = "standard") {
  const { listV2Tasks } = await import("./tasks-rpc-v2.js");
  return (await listV2Tasks({ limit, market })).tasks;
}
