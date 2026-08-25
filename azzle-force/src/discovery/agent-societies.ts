import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type SocietyVolume = "high" | "medium" | "low";
export type SocietySurface = "github" | "discord" | "farcaster" | "skills" | "plugin" | "mcp" | "marketplace";

export interface SocietyInstall {
  npx: string;
  mcp: string;
  skill: string;
  site: string;
  market: string;
  writes: string;
}

export interface AgentSociety {
  id: string;
  name: string;
  github?: string;
  url?: string;
  surfaces: SocietySurface[];
  volume: SocietyVolume;
  queries: string[];
  angle: string;
}

export interface SocietyCatalog {
  install: SocietyInstall;
  societies: AgentSociety[];
}

const __dir = dirname(fileURLToPath(import.meta.url));

const FALLBACK_INSTALL: SocietyInstall = {
  npx: "npx @azzle/agents@latest add",
  mcp: "https://www.azzle.org/mcp",
  skill: "azzle-market",
  site: "https://www.azzle.org",
  market: "https://www.azzle.org/market.html",
  writes: "https://mcp.base.org",
};

let cached: SocietyCatalog | null = null;

export function loadSocietyCatalog(): SocietyCatalog {
  if (cached) return cached;

  const candidates = [
    process.env.AZZLE_SOCIETY_CATALOG,
    resolve(__dir, "../../config/agent-societies.json"),
    resolve(process.cwd(), "config/agent-societies.json"),
  ].filter(Boolean) as string[];

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const raw = JSON.parse(readFileSync(path, "utf8")) as SocietyCatalog;
    if (Array.isArray(raw.societies) && raw.societies.length > 0) {
      cached = {
        install: { ...FALLBACK_INSTALL, ...raw.install },
        societies: raw.societies,
      };
      return cached;
    }
  }

  cached = { install: FALLBACK_INSTALL, societies: [] };
  return cached;
}

export function volumeFit(volume: SocietyVolume): number {
  if (volume === "high") return 0.92;
  if (volume === "medium") return 0.78;
  return 0.62;
}

export function societyInstallBlurb(install: SocietyInstall = loadSocietyCatalog().install): string {
  return [
    `Install: ${install.npx}`,
    `Read MCP: ${install.mcp} (open tasks, scope, reputation).`,
    `Writes (claim/deposit/swap): ${install.writes}`,
    `Skill: ${install.skill} · ${install.market}`,
  ].join(" ");
}

export function githubSearchQueries(catalog = loadSocietyCatalog()): string[] {
  const out: string[] = [
    "agent society",
    "multi-agent marketplace",
    "agent commerce protocol",
    "ai agent economy",
    "autonomous agent swarm",
  ];
  for (const s of catalog.societies) {
    for (const q of s.queries.slice(0, 1)) out.push(q);
  }
  return [...new Set(out)];
}

export function volumeSearchQueries(): string[] {
  return [
    "agent marketplace bounty",
    "paid agent task crypto",
    "autonomous agent freelance",
    "agent earning onchain",
    "virtuals agent",
    "olas service agent",
    "agentverse agent",
    "crewai production crew",
    "mcp server paid tools",
    "eliza plugin agent",
  ];
}
