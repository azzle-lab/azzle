export interface AzzleMarketTask {
  id: string;
  state: string;
  market?: string;
  posterId: string | null;
  workerId: string | null;
  fundedAzlWei: string;
  escrowAmount: string;
  observedAtMs?: number;
}

/** @deprecated use AzzleMarketTask — kept for hunter call sites */
export type BaseRpcTask = {
  id: string;
  state: string;
  poster: { id: string };
  worker: { id: string } | null;
  escrowAmount: string;
  createdAt: string;
};

const ZERO = "0x0000000000000000000000000000000000000000";

function asAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) return null;
  if (value.toLowerCase() === ZERO) return null;
  return value;
}

function mapTask(raw: Record<string, unknown>, market: string): AzzleMarketTask {
  const posterRaw = raw.poster;
  const posterId =
    typeof posterRaw === "object" && posterRaw && "id" in posterRaw
      ? asAddress((posterRaw as { id?: unknown }).id)
      : asAddress(posterRaw);
  const workerRaw = raw.worker;
  const workerId =
    typeof workerRaw === "object" && workerRaw && workerRaw !== null && "id" in workerRaw
      ? asAddress((workerRaw as { id?: unknown }).id)
      : asAddress(workerRaw);

  const funded = String(raw.fundedAzlWei ?? raw.escrowAmount ?? "0");
  return {
    id: String(raw.id ?? ""),
    state: String(raw.state ?? ""),
    market: String(raw.market ?? market),
    posterId,
    workerId,
    fundedAzlWei: funded,
    escrowAmount: funded,
  };
}

export class AzzleBaseRpc {
  constructor(private readonly endpoint = "https://www.azzle.org") {}

  private root(): string {
    return this.endpoint.replace(/\/$/, "");
  }

  async getOpenTasks(limit = 50, market = "standard"): Promise<BaseRpcTask[]> {
    const mapped = await this.fetchTasks(`/api/market/open?market=${encodeURIComponent(market)}&limit=${limit}`, market);
    return mapped.map((t) => ({
      id: t.id,
      state: t.state,
      poster: { id: t.posterId ?? "" },
      worker: t.workerId ? { id: t.workerId } : null,
      escrowAmount: t.escrowAmount,
      createdAt: "",
    }));
  }

  async getRecentMarketTasks(limit = 80, market: "standard" | "micro" = "standard"): Promise<AzzleMarketTask[]> {
    return this.fetchTasks(
      `/api/market/recent?market=${encodeURIComponent(market)}&limit=${encodeURIComponent(String(limit))}`,
      market
    );
  }

  async getRecentPayingTasks(limit = 80): Promise<AzzleMarketTask[]> {
    const [standard, micro] = await Promise.all([
      this.getRecentMarketTasks(limit, "standard"),
      this.getRecentMarketTasks(limit, "micro"),
    ]);
    return [...standard, ...micro];
  }

  async getTopAgents(_limit = 20): Promise<Array<{ id: string; reputationScore: string; tasksCompleted: number }>> {
    return [];
  }

  private async fetchTasks(path: string, market: string): Promise<AzzleMarketTask[]> {
    try {
      const res = await fetch(`${this.root()}${path}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) return [];
      const json = (await res.json()) as { tasks?: Array<Record<string, unknown>> };
      return (json.tasks ?? []).map((row) => mapTask(row, market)).filter((t) => t.id);
    } catch {
      return [];
    }
  }
}
