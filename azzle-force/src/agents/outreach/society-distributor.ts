import { BaseAgent } from "../base.js";
import type { ForceContext } from "../../context.js";
import type { AgentIdentity } from "../../types.js";
import { SUBJECTS } from "../../events/subjects.js";
import { loadSocietyCatalog, societyInstallBlurb } from "../../discovery/agent-societies.js";
import { isClockworkBreaching } from "../../brain/clockwork-state.js";
import { GraphWriter } from "../../graph/writer.js";
import { enrichEntityContacts } from "../../discovery/enrich-contacts.js";
import { isReachableForOutreach, primaryEmail } from "../../delivery/contacts.js";
import { farcasterAutopostEnabled, loadFarcasterConfig } from "../../farcaster/config.js";
import { canFarcasterAction } from "../../farcaster/rate-limit.js";

const ID: AgentIdentity = {
  id: "society-distributor",
  name: "Society Distributor",
  layer: "outreach",
  modelTier: "medium",
  mission: "Push AZZLE into agent societies as a distribution channel — skills, MCP, maintainer outreach.",
  publishSubjects: [SUBJECTS.OUTREACH_DRAFT_READY, SUBJECTS.OUTREACH_SENT],
  subscribeSubjects: [SUBJECTS.DISCOVERY_COMMUNITY_FOUND, SUBJECTS.CLOCKWORK_BREACH, SUBJECTS.MISSION_ASSIGNED],
};

const COOLDOWN_OK_MS = 6 * 60 * 60 * 1000;
const COOLDOWN_BREACH_MS = 45 * 60 * 1000;

export class SocietyDistributor extends BaseAgent {
  constructor(ctx: ForceContext) {
    super(ctx, ID);
  }

  protected async onEvent(subject: string, msg: import("../../types.js").NatsMessage): Promise<void> {
    if (msg.entity_id && subject === SUBJECTS.DISCOVERY_COMMUNITY_FOUND) {
      await this.distributeEntity(msg.entity_id);
    }
  }

  protected async tick(): Promise<void> {
    const breach = await isClockworkBreaching(this.ctx);
    const catalog = loadSocietyCatalog();
    const targets: Array<Record<string, unknown>> = [];

    for (const society of catalog.societies) {
      const row = await this.ctx.postgres.getEntityByName(society.name, "community");
      if (row) targets.push(row);
    }

    const volume = await this.ctx.postgres.listEntities(60, "agent");
    for (const row of volume) {
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      if (meta.volume_signal === true) targets.push(row);
    }

    let emailed = 0;
    let casted = 0;
    let skipped = 0;
    const cap = breach ? 8 : 4;
    for (const row of targets) {
      if (emailed + casted >= cap) break;
      const result = await this.distributeEntity(String(row.id), breach);
      if (result === "email") emailed++;
      else if (result === "farcaster") casted++;
      else skipped++;
    }

    console.log(
      `[${this.identity.id}] ${emailed} maintainer email(s), ${casted} farcaster recipe(s), ${skipped} skipped${breach ? " (breach)" : ""}`
    );
  }

  private async distributeEntity(
    entityId: string,
    breach?: boolean
  ): Promise<"email" | "farcaster" | "skip"> {
    const entity = await this.ctx.postgres.getEntity(entityId);
    if (!entity) return "skip";
    const meta = (entity.metadata ?? {}) as Record<string, unknown>;
    if (this.isInboxlessVenue(entity.name, meta)) return "skip";

    const last = Date.parse(String(meta.last_distributed_at ?? ""));
    const cooldown = (breach ?? (await isClockworkBreaching(this.ctx))) ? COOLDOWN_BREACH_MS : COOLDOWN_OK_MS;
    if (Number.isFinite(last) && Date.now() - last < cooldown) return "skip";

    await enrichEntityContacts(this.ctx, entityId, this.identity.id);
    const fresh = (await this.ctx.postgres.getEntity(entityId)) ?? entity;
    const record = fresh as Record<string, unknown>;
    const reachable = isReachableForOutreach(
      record,
      this.ctx.delivery.channelsReady(),
      this.ctx.config.outreachDmEnabled,
      this.ctx.config.outreachPreferEmail
    );

    const catalog = loadSocietyCatalog();
    const blurb = societyInstallBlurb(catalog.install);
    const angle = String(
      ((fresh.metadata ?? {}) as Record<string, unknown>).angle ??
        "Agents already doing task volume can settle that work on AZZLE."
    );

    if (reachable && primaryEmail(record)) {
      const drafted = await this.draftMaintainerEmail(entityId, String(fresh.name), angle, blurb, cooldown);
      await this.markDistributed(entityId, String(fresh.type), String(fresh.name), {
        ...(fresh.metadata as Record<string, unknown>),
        preferred_channel: "email",
      });
      return drafted ? "email" : "skip";
    }

    const casted = await this.castInstallRecipe(entityId, String(fresh.name), blurb);
    await this.markDistributed(entityId, String(fresh.type), String(fresh.name), {
      ...(fresh.metadata as Record<string, unknown>),
      preferred_channel: "farcaster",
    });
    return casted ? "farcaster" : "skip";
  }

  private isInboxlessVenue(name: string, meta: Record<string, unknown>): boolean {
    const url = String(meta.url ?? "");
    if (/discord\.(gg|com)|reddit\.com\/r\//i.test(url)) return true;
    if (/discord|subreddit|^r\//i.test(name)) return true;
    return false;
  }

  private async draftMaintainerEmail(
    entityId: string,
    name: string,
    angle: string,
    blurb: string,
    cooldown: number
  ): Promise<boolean> {
    const latest = await this.ctx.postgres.getLatestOutreach(entityId, [
      "draft",
      "pending_approval",
      "sent",
      "skipped_no_contact",
    ]);
    if (latest?.status === "draft" || latest?.status === "pending_approval") return false;
    const sentAt = latest?.sent_at ? Date.parse(String(latest.sent_at)) : 0;
    if (Number.isFinite(sentAt) && Date.now() - sentAt < cooldown) return false;

    const body = [
      `${name} already coordinates agents.`,
      angle,
      blurb,
      "Reply yes if you want the skill dropped into the stack this week.",
    ].join(" ");
    const hash = GraphWriter.hashContent(body);
    await this.ctx.postgres.logOutreach(entityId, "email", "draft", {
      contentHash: hash,
      subject: `${name} × AZZLE task markets`,
      body,
    });
    await this.ctx.bus.publish(
      SUBJECTS.OUTREACH_DRAFT_READY,
      this.identity.id,
      { channel: "email", subject: `${name} × AZZLE task markets`, body, content_hash: hash },
      entityId
    );
    return true;
  }

  private async castInstallRecipe(entityId: string, name: string, blurb: string): Promise<boolean> {
    if (!farcasterAutopostEnabled() || !this.ctx.farcaster?.isConfigured()) {
      console.log(`[${this.identity.id}] ${name} — no maintainer email; farcaster off, skip`);
      return false;
    }

    const recent = await this.ctx.postgres.listRecentOutreach(400);
    const budget = canFarcasterAction(
      recent.map((r) => ({
        channel: String(r.channel ?? ""),
        status: String(r.status ?? ""),
        created_at: r.created_at as string | undefined,
        sent_at: r.sent_at as string | null | undefined,
      })),
      "cast",
      loadFarcasterConfig().rateLimits
    );
    if (!budget.ok) {
      console.log(`[${this.identity.id}] farcaster paused — ${budget.reason}`);
      return false;
    }

    const text = `${name} already runs agent volume. Settlement layer: ${blurb}`.slice(0, 320);
    try {
      const result = await this.ctx.farcaster.publishCast(text);
      if (!result.hash) return false;
      await this.ctx.postgres.logOutreach(entityId, "farcaster_cast", "sent", {
        contentHash: GraphWriter.hashContent(text),
        body: text,
      });
      await this.ctx.bus.publish(
        SUBJECTS.OUTREACH_SENT,
        this.identity.id,
        { channel: "farcaster_cast", destination: result.hash },
        entityId
      );
      console.log(`[${this.identity.id}] farcaster recipe for ${name} ${result.hash.slice(0, 10)}…`);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[${this.identity.id}] farcaster recipe failed: ${message}`);
      return false;
    }
  }

  private async markDistributed(
    entityId: string,
    type: string,
    name: string,
    meta: Record<string, unknown>
  ): Promise<void> {
    await this.ctx.postgres.upsertEntity(
      type,
      name,
      {
        ...meta,
        last_distributed_at: new Date().toISOString(),
        distribution: {
          preferred_channel: meta.preferred_channel ?? "farcaster",
          proximity: "agent_society",
          routed_at: new Date().toISOString(),
        },
      },
      entityId
    );
  }
}
