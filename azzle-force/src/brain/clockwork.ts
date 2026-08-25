import type { PayingClient } from "../conversion/paying-clients.js";
import { uniquePayingInWindow } from "../conversion/paying-clients.js";

export const CLOCKWORK_ENTITY_NAME = "_force_clockwork";
export const CLOCKWORK_ENTITY_TYPE = "protocol";

export interface ClockworkConfig {
  enabled: boolean;
  payingClientsPerHour: number;
  windowMs: number;
  breachLowersOutreachGates: boolean;
  breachMinEntities: number;
  breachThreshold: number;
  breachMaxDraftsPerTick: number;
  escalateAgents: string[];
}

export const DEFAULT_CLOCKWORK: ClockworkConfig = {
  enabled: true,
  payingClientsPerHour: 1,
  windowMs: 60 * 60 * 1000,
  breachLowersOutreachGates: true,
  breachMinEntities: 10,
  breachThreshold: 0.4,
  breachMaxDraftsPerTick: 16,
  escalateAgents: [
    "society-hunter",
    "volume-hunter",
    "society-distributor",
    "personalizer",
    "messenger",
    "closer",
    "farcaster-poster",
  ],
};

export interface ClockworkSnapshot {
  ok: boolean;
  breach: boolean;
  uniquePayingLastHour: number;
  target: number;
  deficit: number;
  windowMs: number;
  evaluatedAt: string;
  consecutiveBreaches: number;
  lastOkAt: string | null;
  clients: PayingClient[];
}

export function resolveClockworkConfig(raw?: Partial<ClockworkConfig> | null): ClockworkConfig {
  return {
    ...DEFAULT_CLOCKWORK,
    ...raw,
    escalateAgents: raw?.escalateAgents?.length ? raw.escalateAgents : DEFAULT_CLOCKWORK.escalateAgents,
  };
}

export function evaluateClockwork(opts: {
  clients: PayingClient[];
  nowMs?: number;
  config: ClockworkConfig;
  previousConsecutiveBreaches?: number;
  previousLastOkAt?: string | null;
}): ClockworkSnapshot {
  const nowMs = opts.nowMs ?? Date.now();
  const unique = uniquePayingInWindow(opts.clients, nowMs, opts.config.windowMs);
  const count = unique.length;
  const target = Math.max(1, opts.config.payingClientsPerHour);
  const deficit = Math.max(0, target - count);
  const ok = count >= target;
  const consecutiveBreaches = ok ? 0 : (opts.previousConsecutiveBreaches ?? 0) + 1;
  return {
    ok,
    breach: !ok,
    uniquePayingLastHour: count,
    target,
    deficit,
    windowMs: opts.config.windowMs,
    evaluatedAt: new Date(nowMs).toISOString(),
    consecutiveBreaches,
    lastOkAt: ok ? new Date(nowMs).toISOString() : opts.previousLastOkAt ?? null,
    clients: unique,
  };
}

export function formatClockworkReport(snap: ClockworkSnapshot): string {
  const status = snap.ok ? "OK" : "BREACH";
  const lines = [
    `=== CLOCKWORK SLA (${status}) ===`,
    `Paying clients last hour: ${snap.uniquePayingLastHour} / ${snap.target}`,
  ];
  if (!snap.ok) {
    lines.push(`Deficit: ${snap.deficit} · consecutive misses: ${snap.consecutiveBreaches}`);
    lines.push("Not working: less than one paying client per hour.");
  }
  if (snap.clients.length > 0) {
    lines.push("Recent payers:");
    for (const c of snap.clients.slice(0, 8)) {
      lines.push(`  ${c.role} ${c.address.slice(0, 10)}…  ${c.taskId}  ${c.market}`);
    }
  }
  return lines.join("\n");
}
