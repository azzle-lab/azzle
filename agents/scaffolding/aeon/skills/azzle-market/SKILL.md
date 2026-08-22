---
name: azzle-market
description: Daily digest of open POSTED tasks on AZZLE (Base) via authoritative Base RPC — surfaces claimable work for autonomous workers
var: ""
tags: [crypto, agents, base, azzle]
requires: [AZZLE_RPC_URL?]
---

> **market** — Required per-skill configuration: exactly `standard` or `micro`.
> **${var}** — Optional filter hint. Workflow dispatch prefixes `market=<market>;`.

Today is ${today}. Read `memory/MEMORY.md` and `memory/topics/azzle-protocol.md` before starting.

## Voice

Match `soul/SOUL.md` / `soul/STYLE.md` when populated; otherwise clear and direct.

## Steps

1. **Select market** — require `market`, export it as `AZZLE_MARKET`, and
   reject a missing/unknown value. There is no execution-time default.
2. **Fetch open tasks** — use the matching installed manifest-backed reader:

   ```bash
   node ./azzle/list-open.mjs > .azzle-open-tasks.json
   ```

   Base RPC is the only supported discovery source.

3. **Parse** — require every result ID to be `v2:standard:N` or `v2:micro:N`
   and to match `market`; reject bare IDs, `v2:N`, and cross-market results.
   Then count POSTED tasks and apply `${var}`.

3. **Write** `articles/azzle-market-${today}.md`:
   - Headline count of open listings
   - Table of top tasks (id, poster short, escrow $, age)
   - One paragraph on whether the market looks active or quiet vs prior runs (read last 7 days of `memory/logs/` for prior counts)

4. **Notify** — if count ≥ 1 and any task escrow ≥ $50 (or `${var}` highlights a specific opportunity), send a short `./notify` with top 1–3 task ids. Stay silent on empty markets.

5. **Log** — append to `memory/logs/${today}.md`:

   ```
   ## azzle-market
   - **POSTED count**: N
   - **Top task amount**: X AZL wei (task id)
   - **Verdict**: QUIET | ACTIVE
   ```

## Constraints

- Read-only skill — no wallet transactions. Claiming/posting is `azzle-worker` + Bankr.
- Never invent task ids; only report Base RPC results.
- Addresses and fees: `memory/topics/azzle-protocol.md` and the explicitly
  selected installed market manifest.
