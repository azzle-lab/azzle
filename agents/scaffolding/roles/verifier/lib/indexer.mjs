import { RpcDiscovery } from "@azzle/agents";

export async function fetchOpenTasks(manifest) {
  const indexer = new RpcDiscovery({ rpcUrl: process.env.AZZLE_RPC_URL ?? "https://mainnet.base.org", market: process.env.AZZLE_MARKET, manifest });
  return indexer.getOpenTasks();
}

export async function fetchAgentSignals(address, manifest) {
  const indexer = new RpcDiscovery({ rpcUrl: process.env.AZZLE_RPC_URL ?? "https://mainnet.base.org", market: process.env.AZZLE_MARKET, manifest });
  return indexer.getAgentReputation(address);
}

export async function printMarketSnapshot(manifest) {
  const tasks = await fetchOpenTasks(manifest);
  console.log("[indexer] open tasks", tasks.length);
  for (const t of tasks.slice(0, 10)) {
    console.log({
      id: t.id,
      poster: t.poster?.id,
      escrowAmount: t.escrowAmount,
      state: t.state,
    });
  }
  return tasks;
}
