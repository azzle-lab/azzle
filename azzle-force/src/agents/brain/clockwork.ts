import { BaseAgent } from "../base.js";
import type { ForceContext } from "../../context.js";
import type { AgentIdentity } from "../../types.js";
import { SUBJECTS } from "../../events/subjects.js";
import { runClockworkTick } from "../../brain/clockwork-state.js";
import { resolveClockworkConfig } from "../../brain/clockwork.js";

const ID: AgentIdentity = {
  id: "clockwork",
  name: "Clockwork",
  layer: "brain",
  modelTier: "cheap",
  mission: "One paying client per hour or the organism is not working — measure, alarm, escalate.",
  publishSubjects: [SUBJECTS.CLOCKWORK_BREACH, SUBJECTS.MISSION_ASSIGNED],
  subscribeSubjects: [SUBJECTS.OUTCOME_RECORDED, SUBJECTS.OUTREACH_SENT],
};

export class Clockwork extends BaseAgent {
  constructor(ctx: ForceContext) {
    super(ctx, ID);
  }

  protected async onEvent(_subject: string, _msg: import("../../types.js").NatsMessage): Promise<void> {
    const cfg = resolveClockworkConfig(this.ctx.config.forceConfig.clockwork);
    if (!cfg.enabled) return;
    await runClockworkTick(this.ctx, this.identity.id);
  }

  protected async tick(): Promise<void> {
    const cfg = resolveClockworkConfig(this.ctx.config.forceConfig.clockwork);
    if (!cfg.enabled) return;
    await runClockworkTick(this.ctx, this.identity.id);
  }
}
