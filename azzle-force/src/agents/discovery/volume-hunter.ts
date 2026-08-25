import { BaseAgent } from "../base.js";
import type { ForceContext } from "../../context.js";
import type { AgentIdentity } from "../../types.js";
import { SUBJECTS } from "../../events/subjects.js";
import { volumeSearchQueries } from "../../discovery/agent-societies.js";

const ID: AgentIdentity = {
  id: "volume-hunter",
  name: "Volume Hunter",
  layer: "discovery",
  modelTier: "cheap",
  mission: "Find agents and stacks that already do paid task volume — the fastest path to paying AZZLE clients.",
  publishSubjects: [SUBJECTS.DISCOVERY_AGENT_FOUND],
  subscribeSubjects: [SUBJECTS.MISSION_ASSIGNED, SUBJECTS.CLOCKWORK_BREACH],
};

export class VolumeHunter extends BaseAgent {
  private queryIndex = 0;

  constructor(ctx: ForceContext) {
    super(ctx, ID);
  }

  protected async tick(): Promise<void> {
    const queries = volumeSearchQueries();
    const batch = Math.min(3, queries.length);
    let count = 0;

    for (let i = 0; i < batch; i++) {
      const q = queries[(this.queryIndex + i) % queries.length];
      const repos = await this.ctx.github.searchRepos(q, 10);
      for (const repo of repos) {
        const parsed = await this.hunterEnrich(
          {
            full_name: repo.full_name,
            owner: repo.owner.login,
            html_url: repo.html_url,
            description: repo.description,
            topics: repo.topics,
            stargazers_count: repo.stargazers_count,
            search_query: q,
          },
          "agent",
          "Prioritize agents, crews, and marketplaces that already execute paid tasks, bounties, or on-chain jobs. azzle_fit is likelihood they will post or claim on AZZLE this week — not generic popularity."
        );
        const stars = repo.stargazers_count ?? 0;
        const volumeHint = /bounty|marketplace|paid|earn|commerce|crew|swarm|auton/i.test(
          `${repo.description ?? ""} ${(repo.topics ?? []).join(" ")} ${q}`
        );
        const fit = Math.min(
          1,
          Math.max(parsed.azzle_fit ?? 0, volumeHint ? 0.8 : 0) + Math.min(stars / 8000, 0.12)
        );
        await this.ctx.writer.write({
          agent: this.identity.id,
          type: parsed.type,
          name: parsed.name,
          metadata: {
            repo: parsed.repo ?? repo.html_url,
            owner: parsed.owner ?? repo.owner.login,
            description: parsed.description ?? repo.description,
            stars,
            skills: parsed.skills ?? repo.topics,
            search_query: q,
            distribution_class: "task_volume_agent",
            volume_signal: true,
          },
          embedText: `${parsed.name} task-volume agent ${parsed.description ?? repo.description ?? ""}`,
          embedCollection: "entities",
          score: { type: "azzle_probability", value: fit, reason: "volume-hunter" },
          natsSubject: SUBJECTS.DISCOVERY_AGENT_FOUND,
          natsPayload: { repo_url: repo.html_url, azzle_probability: fit, volume_signal: true },
        });
        count++;
      }
    }

    this.queryIndex = (this.queryIndex + batch) % Math.max(queries.length, 1);
    console.log(`[${this.identity.id}] indexed ${count} volume-agent candidates`);
  }
}
