/** Base RPC discovery client for one V2 market graph. */
import { Contract, JsonRpcProvider } from "ethers";
import { V2_TASK_STATE_NAMES } from "./client-v2.js";
import { loadMarketManifest, namespacedTaskId, parseTaskRef, resolveExpectedMarket, type AzzleMarket, type TaskRef } from "./markets.js";
import type { BaseMainnetV2Manifest } from "./manifest-v2.js";

const ABI = [
  "function taskCount() view returns (uint256)",
  "function tasks(uint256) view returns (address poster,address worker,uint256 totalAmount,uint256 funded,uint256 released,uint64 deadline,uint64 fundingDeadline,uint64 deliveredAt,uint8 state)",
];
const ZERO = "0x0000000000000000000000000000000000000000";
const REPUTATION_ABI = ["function reputation(address) view returns (uint64 completed,uint64 wins,uint64 losses)"];
const BOND_ABI = ["function bonds(address) view returns (uint256)"];

export interface RpcAgentReputation {
  id: string; completed: string; wins: string; losses: string; verifierBondAzl: string;
}

export interface RpcDiscoveryTask {
  protocolVersion: "v2"; asset: "AZL"; registryAddress: string;
  market?: string;
  id: string; state: string; poster: { id: string }; worker: { id: string } | null;
  escrowAmount: string; createdAt: string; updatedAt: string; settlementDigest: string | null;
}
export interface RpcDiscoveryConfig {
  rpcUrl?: string;
  registryAddress?: string;
  scanWindow?: number;
  market?: AzzleMarket | string;
  manifest?: BaseMainnetV2Manifest;
}

export class RpcDiscovery {
  private readonly registry: Contract;
  private readonly scanWindow: number;
  private readonly reputation: Contract;
  private readonly bonds: Contract;
  readonly market: AzzleMarket;
  constructor(config: RpcDiscoveryConfig = {}) {
    this.market = resolveExpectedMarket(config.market, config.manifest);
    const manifest = config.manifest ?? loadMarketManifest(this.market);
    if (!manifest.market) throw new Error("RpcDiscovery manifest must declare market.");
    resolveExpectedMarket(this.market, manifest);
    if (
      config.registryAddress &&
      config.registryAddress.toLowerCase() !== manifest.taskRegistry.toLowerCase()
    ) {
      throw new Error(`registryAddress does not belong to selected '${this.market}' manifest.`);
    }
    this.registry = new Contract(
      config.registryAddress ?? manifest.taskRegistry,
      ABI,
      new JsonRpcProvider(config.rpcUrl ?? process.env.BASE_RPC_URL ?? "https://mainnet.base.org")
    );
    const provider = this.registry.runner;
    this.reputation = new Contract(manifest.reputationRegistry, REPUTATION_ABI, provider);
    this.bonds = new Contract(manifest.verifierBondVault, BOND_ABI, provider);
    this.scanWindow = Math.min(Math.max(config.scanWindow ?? 5_000, 100), 10_000);
  }
  private map(id: bigint, row: any): RpcDiscoveryTask {
    const createdAt = "0";
    const worker = String(row.worker).toLowerCase();
    return {
      protocolVersion: "v2", asset: "AZL", registryAddress: String(this.registry.target),
      market: this.market,
      id: namespacedTaskId(this.market, id), state: V2_TASK_STATE_NAMES[Number(row.state)] ?? `UNKNOWN(${row.state})`,
      poster: { id: String(row.poster).toLowerCase() },
      worker: worker === ZERO ? null : { id: worker },
      escrowAmount: row.totalAmount.toString(), createdAt, updatedAt: createdAt,
      settlementDigest: null,
    };
  }
  private async scan(filter: (task: RpcDiscoveryTask) => boolean, limit: number) {
    const total = Number(await this.registry.taskCount());
    const first = Math.min(Math.max(Number(limit) || 100, 1), 100);
    const start = Math.max(1, total - this.scanWindow + 1);
    const out: RpcDiscoveryTask[] = [];
    for (let id = total; id >= start && out.length < first; id--) {
      try {
        const task = this.map(BigInt(id), await this.registry.tasks(id));
        if (filter(task)) out.push(task);
      } catch { /* ignore an invalid historical row */ }
    }
    return out;
  }
  getOpenTasks(limit = 100) { return this.scan((task) => task.state === "POSTED", limit); }
  getRecentTasks(limit = 50) { return this.scan(() => true, limit); }
  getTasksByPoster(poster: string, limit = 25) {
    const id = poster.toLowerCase();
    return this.scan((task) => task.poster.id === id, limit);
  }
  getTasksByWorker(worker: string, limit = 25) {
    const id = worker.toLowerCase();
    return this.scan((task) => task.worker?.id === id, limit);
  }
  async getAgentReputation(address: string): Promise<RpcAgentReputation> {
    const [row, bond] = await Promise.all([this.reputation.reputation(address), this.bonds.bonds(address)]);
    return { id: address.toLowerCase(), completed: row.completed.toString(), wins: row.wins.toString(), losses: row.losses.toString(), verifierBondAzl: bond.toString() };
  }

  async getTask(taskId: TaskRef | string) {
    try {
      const localId = parseTaskRef(taskId, this.market).localIdBigInt;
      const task = this.map(localId, await this.registry.tasks(localId));
      return task.poster.id === ZERO ? null : task;
    } catch (error) {
      if (error instanceof Error && /Task id|task id|belongs to/.test(error.message)) throw error;
      return null;
    }
  }
}
