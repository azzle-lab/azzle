# AZZLE FORCE

Distributed Expansion Organism (DEO) for AZZLE ecosystem growth on Base.

**Spec:** [`../docs/AZZLE_FORCE.md`](../docs/AZZLE_FORCE.md) (canonical system prompt)

## Architecture

```
Knowledge Graph (Postgres + Neo4j + Qdrant)
        │
   NATS events + Temporal workflows
        │
   20 stateless agents → Bankr LLM Gateway
```

| Layer | Components |
|-------|------------|
| Graph | Postgres, Neo4j, Qdrant |
| Nervous system | NATS, Temporal |
| Cognition | Bankr LLM Gateway (`https://llm.bankr.bot`) |
| Agents | 20 hunters, outreach, conversion, intelligence, expansion |

## Quick start

### Without Docker (Windows / lite mode)

```bash
cd azzle-force
cp .env.example .env
npm install
npm run build
npm run lite          # migrate + wave 1 hunters, no Postgres/Docker
```

Graph data is saved to `.azzle-force-lite/graph.json`.

### With Docker (full stack)

```bash
cd azzle-force
cp .env.example .env
npm install
npm run up            # requires Docker Desktop
npm run migrate
npm run build
npm run force wave 1
```

**Launch film:** open [`force_film.html`](force_film.html) fullscreen — press **R** to hide UI while recording (pair with your track).

**Tip:** Don't keep `.azzle-force-lite/graph.json` open in your editor while agents run — saves every ~2s will flicker the file. Use `npm run force status` to inspect counts.

## Clockwork SLA — one paying client per hour

If FORCE does not land **at least one unique paying client per hour**, it is in **breach** and not working.

A paying client is an on-chain wallet that funded task escrow (poster) or paid the access fee to claim (worker) on **standard** or **micro**. Existing historical tasks do not count — only new payers after the clock starts.

On breach, Clockwork:

1. Alarms (`npm run force clockwork` / Observatory **Paying / hour**)
2. Hunts **agent societies** (CAMEL, Virtuals, ElizaOS, CrewAI, Agentverse, Olas, MCP, Bankr, …) as distribution surfaces
3. Hunts agents that **already do task volume**
4. Drafts install payloads: `npx @azzle/agents@latest add` + `https://www.azzle.org/mcp`
5. Lowers outreach gates and shortens follow-up cadence until the SLA recovers

```bash
npm run force clockwork
npm run force wave all    # includes society-hunter, volume-hunter, society-distributor, clockwork
```

Catalog: [`config/agent-societies.json`](config/agent-societies.json)

Run Temporal worker (follow-up + onboarding workflows):

```bash
npm run force worker
```

Single agent:

```bash
npm run force agent repository-hunter
```

## Rollout waves

| Wave | Agents | Gate |
|------|--------|------|
| 1 | Repository, Agent, Builder hunters + Contact Discovery + Relationship Mapper | 500+ entities before outreach |
| 2 | Startup, Community, Opportunity, **Society**, **Volume** hunters + Qualification | Top 50 ranked prospects |
| 3 | Personalizer, Messenger, Follow-up, Ambassador, **Society Distributor**, **Clockwork**, Farcaster | Human approval on Messenger (default) |
| 4 | Onboarding, Matchmaker, Analyst, Trend, Competitive Intel | — |
| 5 | Chief Expansion, Swarm Creator | Swarm Creator on validated niche |
| 6 | **Second Brain** — signal-intake, prospect-scorer, sequencer, objection-handler, closer, **clockwork**, prompt-evolver | Closing + self-iteration — see [`docs/AZZLE_FORCE_SECOND_BRAIN.md`](../docs/AZZLE_FORCE_SECOND_BRAIN.md) |

Set wave: `AZZLE_FORCE_WAVE=6` or `npm run force wave 6` · full pipeline: `npm run force wave all`

## Configuration

| Variable | Purpose |
|----------|---------|
| `BANKR_API_KEY` | LLM Gateway (optional — heuristic fallback without) |
| `AZZLE_LLM_MODEL` | Bankr model ID (default tier lists use DeepSeek first); see [Bankr models](https://docs.bankr.bot/llm-gateway/models) |
| `GITHUB_TOKEN` | GitHub API (optional — seed data without) |
| `HUMAN_APPROVE_OUTREACH` | `true` = Messenger queues drafts for approval |
| `AZZLE_CLOCKWORK` | `false` to disable the 1 paying-client/hour SLA |
| `AZZLE_PAYING_CLIENTS_PER_HOUR` | SLA target (default 1) |
| `azzleProbabilityThreshold` | in `config/default.json` |

Approve outreach:

```bash
npm run force approve-outreach <entity-uuid>
```

Generate trailer video (saved to `outputs/trailers/`):

```bash
npm run trailer -- "your topic here"
npm run trailer -- --list
npm run trailer -- --duration=10 "your topic"
npm run force agent content-studio   # auto-generates on schedule + trend signals
```

Trailers use a **code-based video engine**: the LLM outputs a JSON timeline, the renderer draws frames (SVG → sharp), and **FFmpeg** pipes them into MP4. Install [FFmpeg](https://ffmpeg.org/) and ensure it is in your PATH.

Visual style is controlled by `config/content/style-direction.json` (default: Enter the Void / neon-void palette).

## AZZLE protocol integration

- **Opportunity Hunter** ingests one explicitly selected V2 market from Base RPC; standard and micro result sets are never merged
- **Onboarding Agent** references `QUICKSTART.md`, `BOOTSTRAP.md`, `launch-skills/launch-skills.md`
- Addresses: select `standard` or `micro`, then read the corresponding manifest; do not copy addresses into outreach
- Task references: publish only `v2:standard:N` or `v2:micro:N`
- Economics: defer to `protocol/MARKETS.md`; AZL wei is the protocol payment asset and USD6 values are policy targets

## Operational rules

- No agent-local database — graph is truth
- No agent-to-agent direct calls — NATS or Temporal only
- No direct OpenAI/Anthropic — Bankr Gateway only
- Chief Expansion never performs outreach

## Disaster recovery

1. Restore Neo4j + Postgres
2. Restore Qdrant (rebuildable from Postgres)
3. Redeploy agents
4. Reconfigure LLM Gateway
