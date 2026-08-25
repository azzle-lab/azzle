import type { ForceContext } from "../context.js";
import {
  CLOCKWORK_ENTITY_NAME,
  CLOCKWORK_ENTITY_TYPE,
  evaluateClockwork,
  formatClockworkReport,
  resolveClockworkConfig,
  type ClockworkConfig,
  type ClockworkSnapshot,
} from "./clockwork.js";
import {
  mergePayingClients,
  parseStoredClients,
  payingClientsFromTasks,
  type PayingClient,
} from "../conversion/paying-clients.js";
import { SUBJECTS } from "../events/subjects.js";

export async function loadClockworkState(ctx: ForceContext): Promise<{
  entityId: string | null;
  clients: PayingClient[];
  consecutiveBreaches: number;
  lastOkAt: string | null;
  lastSnapshot: ClockworkSnapshot | null;
}> {
  const row = await ctx.postgres.getEntityByName(CLOCKWORK_ENTITY_NAME, CLOCKWORK_ENTITY_TYPE);
  if (!row) {
    return { entityId: null, clients: [], consecutiveBreaches: 0, lastOkAt: null, lastSnapshot: null };
  }
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const lastSnapshot = (meta.last_snapshot as ClockworkSnapshot | undefined) ?? null;
  return {
    entityId: String(row.id),
    clients: parseStoredClients(meta.paying_clients),
    consecutiveBreaches: Number(meta.consecutive_breaches ?? lastSnapshot?.consecutiveBreaches ?? 0),
    lastOkAt: (meta.last_ok_at as string | null | undefined) ?? lastSnapshot?.lastOkAt ?? null,
    lastSnapshot,
  };
}

export async function isClockworkBreaching(ctx: ForceContext): Promise<boolean> {
  const cfg = resolveClockworkConfig(ctx.config.forceConfig.clockwork);
  if (!cfg.enabled) return false;
  const state = await loadClockworkState(ctx);
  return Boolean(state.lastSnapshot?.breach);
}

export async function clockworkOutreachOverrides(ctx: ForceContext): Promise<{
  breach: boolean;
  minEntities: number;
  threshold: number;
  maxDrafts: number;
}> {
  const cfg = resolveClockworkConfig(ctx.config.forceConfig.clockwork);
  const baseMin = ctx.config.forceConfig.minEntitiesBeforeOutreach;
  const baseThreshold = ctx.config.forceConfig.azzleProbabilityThreshold;
  const breach = cfg.enabled && cfg.breachLowersOutreachGates && (await isClockworkBreaching(ctx));
  return {
    breach,
    minEntities: breach ? Math.min(baseMin, cfg.breachMinEntities) : baseMin,
    threshold: breach ? Math.min(baseThreshold, cfg.breachThreshold) : baseThreshold,
    maxDrafts: breach ? cfg.breachMaxDraftsPerTick : 8,
  };
}

export async function runClockworkTick(ctx: ForceContext, agentId = "clockwork"): Promise<ClockworkSnapshot> {
  const cfg = resolveClockworkConfig(ctx.config.forceConfig.clockwork);
  const now = Date.now();
  console.log(`[clockwork] evaluating SLA — target ${cfg.payingClientsPerHour} paying client(s) / hour`);
  const prev = await loadClockworkState(ctx);

  let incoming: PayingClient[] = [];
  try {
    const tasks = await ctx.azzle.getRecentPayingTasks(80);
    incoming = payingClientsFromTasks(tasks, now);
  } catch (err) {
    console.warn(`[clockwork] market fetch failed:`, err);
  }

  const incomingFresh =
    prev.clients.length === 0
      ? incoming.map((c) => ({ ...c, atMs: now - cfg.windowMs - 1 }))
      : incoming;
  const clients = mergePayingClients(prev.clients, incomingFresh, now);
  const snap = evaluateClockwork({
    clients,
    nowMs: now,
    config: cfg,
    previousConsecutiveBreaches: prev.consecutiveBreaches,
    previousLastOkAt: prev.lastOkAt,
  });

  const entityId = await ctx.postgres.upsertEntity(
    CLOCKWORK_ENTITY_TYPE,
    CLOCKWORK_ENTITY_NAME,
    {
      paying_clients: clients,
      last_snapshot: snap,
      consecutive_breaches: snap.consecutiveBreaches,
      last_ok_at: snap.lastOkAt,
      breach: snap.breach,
      unique_paying_last_hour: snap.uniquePayingLastHour,
      target: snap.target,
      evaluated_at: snap.evaluatedAt,
    },
    prev.entityId ?? undefined
  );

  await ctx.postgres.upsertScore(
    entityId,
    "clockwork_ok",
    snap.ok ? 1 : 0,
    snap.ok ? "hourly paying-client SLA met" : `deficit ${snap.deficit}`
  );
  await ctx.postgres.logAudit(agentId, "clockwork_tick", {
    ok: snap.ok,
    unique: snap.uniquePayingLastHour,
    target: snap.target,
    consecutive: snap.consecutiveBreaches,
  }, entityId);

  if (snap.breach) {
    await ctx.bus.publish(
      SUBJECTS.CLOCKWORK_BREACH,
      agentId,
      {
        unique: snap.uniquePayingLastHour,
        target: snap.target,
        deficit: snap.deficit,
        consecutive: snap.consecutiveBreaches,
      },
      entityId
    );
    await escalateClockwork(ctx, cfg, entityId);
  }

  console.log(formatClockworkReport(snap));
  return snap;
}

async function escalateClockwork(
  ctx: ForceContext,
  cfg: ClockworkConfig,
  entityId: string
): Promise<void> {
  for (const agentType of cfg.escalateAgents) {
    const pending = await ctx.postgres.listPendingMissions(agentType);
    if (pending.length > 0) continue;
    await ctx.postgres.createMission(agentType, entityId, {
      reason: "clockwork_breach",
      sla: "one_paying_client_per_hour",
    });
    await ctx.bus.publish(
      SUBJECTS.MISSION_ASSIGNED,
      "clockwork",
      { agent_type: agentType, reason: "clockwork_breach" },
      entityId
    );
  }
  console.log(`[clockwork] BREACH — assigned ${cfg.escalateAgents.join(", ")}`);
}

export async function printClockworkStatus(ctx: ForceContext): Promise<ClockworkSnapshot> {
  const snap = await runClockworkTick(ctx, "clockwork-cli");
  return snap;
}
