import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RpcDiscovery } from "@azzle/agents";

const __dir = dirname(fileURLToPath(import.meta.url));
const market = process.env.AZZLE_MARKET;
if (market !== "standard" && market !== "micro") {
  throw new Error("AZZLE_MARKET must be explicitly set to standard or micro for this skill");
}
const manifest = JSON.parse(
  readFileSync(join(__dir, market === "micro" ? "base-8453-micro.json" : "base-8453-standard.json"), "utf8")
);
if (manifest.market !== market) throw new Error("Selected market does not match installed manifest");
const indexer = new RpcDiscovery({ rpcUrl: process.env.AZZLE_RPC_URL ?? "https://mainnet.base.org", market });
const tasks = (await indexer.getOpenTasks()).map((task) => {
  if (!/^v2:(standard|micro):[1-9]\d*$/.test(task.id) || !task.id.startsWith(`v2:${market}:`)) {
    throw new Error(`Discovery returned non-canonical or cross-market task id: ${task.id}`);
  }
  return task;
});

console.log(
  JSON.stringify(
    {
      network: manifest.network,
      chainId: manifest.chainId,
      market,
      taskRegistry: manifest.taskRegistry,
      count: tasks.length,
      tasks,
    },
    null,
    2
  )
);
