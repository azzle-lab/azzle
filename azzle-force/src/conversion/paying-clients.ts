import type { AzzleMarketTask } from "../tools/azzle.js";

export type PayingRole = "poster" | "worker";

export interface PayingClient {
  address: string;
  role: PayingRole;
  taskId: string;
  market: string;
  atMs: number;
  paidAzlWei: string;
}

const ZERO = "0x0000000000000000000000000000000000000000";

function isAddress(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value) && value.toLowerCase() !== ZERO;
}

function wei(value: unknown): bigint {
  try {
    const n = BigInt(String(value ?? "0"));
    return n < 0n ? 0n : n;
  } catch {
    return 0n;
  }
}

/** Poster paid escrow; worker paid the access fee to claim. */
export function payingClientsFromTasks(tasks: AzzleMarketTask[], seenAtMs = Date.now()): PayingClient[] {
  const out: PayingClient[] = [];
  for (const task of tasks) {
    const funded = wei(task.fundedAzlWei || task.escrowAmount);
    const poster = task.posterId;
    const worker = task.workerId;
    const market = task.market ?? "standard";
    const atMs = task.observedAtMs ?? seenAtMs;

    if (poster && funded > 0n) {
      out.push({
        address: poster,
        role: "poster",
        taskId: task.id,
        market,
        atMs,
        paidAzlWei: funded.toString(),
      });
    }
    if (worker) {
      out.push({
        address: worker,
        role: "worker",
        taskId: task.id,
        market,
        atMs,
        paidAzlWei: "0",
      });
    }
  }
  return out;
}

export function mergePayingClients(
  previous: PayingClient[],
  incoming: PayingClient[],
  nowMs: number,
  retainMs = 24 * 60 * 60 * 1000
): PayingClient[] {
  const cutoff = nowMs - retainMs;
  const byKey = new Map<string, PayingClient>();
  for (const c of previous) {
    if (c.atMs < cutoff) continue;
    byKey.set(`${c.address.toLowerCase()}:${c.role}:${c.taskId}`, c);
  }
  for (const c of incoming) {
    const key = `${c.address.toLowerCase()}:${c.role}:${c.taskId}`;
    if (!byKey.has(key)) byKey.set(key, c);
  }
  return [...byKey.values()].sort((a, b) => b.atMs - a.atMs).slice(0, 500);
}

export function uniquePayingInWindow(
  clients: PayingClient[],
  nowMs: number,
  windowMs: number
): PayingClient[] {
  const cutoff = nowMs - windowMs;
  const seen = new Set<string>();
  const out: PayingClient[] = [];
  for (const c of clients) {
    if (c.atMs < cutoff) continue;
    const key = c.address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

export function parseStoredClients(raw: unknown): PayingClient[] {
  if (!Array.isArray(raw)) return [];
  const out: PayingClient[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (!isAddress(r.address)) continue;
    const role = r.role === "worker" ? "worker" : "poster";
    const atMs = Number(r.atMs ?? 0);
    if (!Number.isFinite(atMs) || atMs <= 0) continue;
    out.push({
      address: String(r.address),
      role,
      taskId: String(r.taskId ?? ""),
      market: String(r.market ?? "standard"),
      atMs,
      paidAzlWei: String(r.paidAzlWei ?? "0"),
    });
  }
  return out;
}
