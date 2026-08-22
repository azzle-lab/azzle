/** POSTED (claimable) tasks from the authoritative Base RPC reader. */
import { listV2Tasks } from "./tasks-rpc-v2.js";

export async function getOpenTasks(limit = 100, market = "standard") {
  return (await listV2Tasks({ limit, state: "POSTED", market })).tasks;
}
