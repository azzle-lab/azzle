import { BaseAgent } from "../base.js";
import type { ForceContext } from "../../context.js";
import type { AgentIdentity } from "../../types.js";
import { SUBJECTS } from "../../events/subjects.js";
import {
  githubSearchQueries,
  loadSocietyCatalog,
  volumeFit,
  type AgentSociety,
} from "../../discovery/agent-societies.js";

const ID: AgentIdentity = {
  id: "society-hunter",
  name: "Society Hunter",
  layer: "discovery",
  modelTier: "cheap",
  mission: "Find agent-society projects and index them as distribution surfaces — not just prospects.",
  publishSubjects: [SUBJECTS.DISCOVERY_COMMUNITY_FOUND, SUBJECTS.DISCOVERY_AGENT_FOUND],
  subscribeSubjects: [SUBJECTS.MISSION_ASSIGNED, SUBJECTS.CLOCKWORK_BREACH],
};

export class SocietyHunter extends BaseAgent {
  private queryIndex = 0;

  constructor(ctx: ForceContext) {
    super(ctx, ID);
  }

  protected async tick(): Promise<void> {
    const catalog = loadSocietyCatalog();
    let seeded = 0;
    for (const society of catalog.societies) {
      await this.indexSociety(society);
      seeded++;
    }

    const queries = githubSearchQueries(catalog);
    const batch = Math.min(2, queries.length);
    let hunted = 0;
    for (let i = 0; i < batch; i++) {
      const q = queries[(this.queryIndex + i) % queries.length];
      const repos = await this.ctx.github.searchRepos(q, 8);
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
          "community",
          "Classify as agent society / multi-agent marketplace / agent economy when the project hosts or coordinates many agents that already do work. High azzle_fit if they already have task volume we can distribute into."
        );
        const fit = Math.max(parsed.azzle_fit ?? 0, Math.min((repo.stargazers_count ?? 0) / 4000, 0.85));
        await this.ctx.writer.write({
          agent: this.identity.id,
          type: parsed.type === "community" ? "community" : parsed.type,
          name: parsed.name,
          metadata: {
            repo: parsed.repo ?? repo.html_url,
            owner: parsed.owner ?? repo.owner.login,
            description: parsed.description ?? repo.description,
            stars: repo.stargazers_count,
            skills: parsed.skills ?? repo.topics,
            search_query: q,
            distribution_class: "agent_society",
            volume_signal: fit >= 0.7,
          },
          embedText: `${parsed.name} agent society ${parsed.description ?? repo.description ?? ""}`,
          embedCollection: "communities",
          score: { type: "azzle_probability", value: fit, reason: "society-hunter" },
          natsSubject: SUBJECTS.DISCOVERY_COMMUNITY_FOUND,
          natsPayload: { repo_url: repo.html_url, azzle_probability: fit, distribution_class: "agent_society" },
        });
        hunted++;
      }
    }
    this.queryIndex = (this.queryIndex + batch) % Math.max(queries.length, 1);
    console.log(`[${this.identity.id}] seeded ${seeded} catalog societies, hunted ${hunted} repos`);
  }

  private async indexSociety(society: AgentSociety): Promise<void> {
    const fit = volumeFit(society.volume);
    await this.ctx.writer.write({
      agent: this.identity.id,
      type: "community",
      name: society.name,
      metadata: {
        society_id: society.id,
        url: society.url,
        repo: society.github ? `https://github.com/${society.github}` : undefined,
        owner: society.github?.split("/")[0],
        surfaces: society.surfaces,
        volume: society.volume,
        angle: society.angle,
        distribution_class: "agent_society",
        volume_signal: society.volume === "high",
      },
      embedText: `${society.name} agent society ${society.angle} ${(society.surfaces ?? []).join(" ")}`,
      embedCollection: "communities",
      score: { type: "azzle_probability", value: fit, reason: `catalog ${society.volume} volume` },
      natsSubject: SUBJECTS.DISCOVERY_COMMUNITY_FOUND,
      natsPayload: { society_id: society.id, azzle_probability: fit },
    });
  }
}
