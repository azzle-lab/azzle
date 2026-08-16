/** Base RPC discovery client for the canonical V2 TaskRegistry. */
import { Contract, JsonRpcProvider } from "ethers";
import { BASE_MAINNET_MANIFEST } from "./manifest.js";
import { V2_TASK_STATE_NAMES } from "./client-v2.js";

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
  id: string; state: string; poster: { id: string }; worker: { id: string } | null;
  escrowAmount: string; createdAt: string; updatedAt: string; settlementDigest: string | null;
}
export interface RpcDiscoveryConfig {
  rpcUrl?: string; registryAddress?: string; scanWindow?: number;
}

export class RpcDiscovery {
  private readonly registry: Contract;
  private readonly scanWindow: number;
  private readonly reputation: Contract;
  private readonly bonds: Contract;
  constructor(config: RpcDiscoveryConfig = {}) {
    this.registry = new Contract(
      config.registryAddress ?? BASE_MAINNET_MANIFEST.taskRegistry,
      ABI,
      new JsonRpcProvider(config.rpcUrl ?? process.env.BASE_RPC_URL ?? "https://mainnet.base.org")
    );
    const provider = this.registry.runner;
    this.reputation = new Contract(BASE_MAINNET_MANIFEST.reputationRegistry, REPUTATION_ABI, provider);
    this.bonds = new Contract(BASE_MAINNET_MANIFEST.verifierBondVault, BOND_ABI, provider);
    this.scanWindow = Math.min(Math.max(config.scanWindow ?? 5_000, 100), 10_000);
  }
  private map(id: bigint, row: any): RpcDiscoveryTask {
    const createdAt = "0";
    const worker = String(row.worker).toLowerCase();
    return {
      protocolVersion: "v2", asset: "AZL", registryAddress: String(this.registry.target),
      id: `v2:${id.toString()}`, state: V2_TASK_STATE_NAMES[Number(row.state)] ?? `UNKNOWN(${row.state})`,
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

  async getTask(taskId: string | bigint) {
    try {
      const task = this.map(BigInt(taskId), await this.registry.tasks(taskId));
      return task.poster.id === ZERO ? null : task;
    } catch { return null; }
  }
}
