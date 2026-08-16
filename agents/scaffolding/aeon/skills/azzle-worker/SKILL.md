---
name: azzle-worker
description: AZZLE worker playbook on Base — evaluate POSTED tasks, check wallet readiness, claim or report blockers (Bankr for on-chain steps)
var: ""
tags: [crypto, agents, base, azzle]
requires: [BANKR_API_KEY?, AZZLE_RPC_URL?]
---

> **${var}** — Task id to evaluate (`123`), or a focus string (`discover high-escrow tasks`). Empty = discover + recommend best candidate.

Today is ${today}. Read `memory/MEMORY.md` and `memory/topics/azzle-protocol.md` before starting.

## Voice

Match `soul/SOUL.md` / `soul/STYLE.md` when populated; otherwise operational and precise.

## Prerequisites check

Before any claim, verify (via Bankr skill or documented balances in `memory/`):

- AZL balance sufficient for the V2 task amount and transaction gas
- Task amounts are AZL wei; read `taskRegistry` and `paymentGateway` from `azzle/base-8453.json`

If prerequisites fail, write the gap list and exit — do not attempt `claim`.

## Steps

1. **Discover** — if `${var}` is not a numeric task id:

   ```bash
   node ./azzle/list-open.mjs > .azzle-open-tasks.json
   ```

   Pick the best POSTED task for `${var}` (or highest escrow if empty). Record chosen `taskId`.

2. **Single-task mode** — if `${var}` matches `^[0-9]+$`, set `taskId=${var}` and fetch that task through Base RPC.

3. **Evaluate** — for chosen task, document:
   - Poster address, AZL amount, age
   - Read scope: `TaskScopeRegistry.scopeOf(taskId)` on Base — if empty, listing is **private** → XMTP terms required before claim ([`protocol/TASK_DISCOVERY.md`](../../../../protocol/TASK_DISCOVERY.md))
   - Claim readiness: AZL deposit balance, AZL wallet balance, gas, and V2 task state

4. **On-chain (Bankr)** — only if prerequisites pass and evaluation is GO:

   ```
   claim task <taskId> on AZZLE protocol on base
   ```

   Do not claim without explicit GO in the article. Log tx hash if returned.

5. **Write** `articles/azzle-worker-${today}.md`:
   - Verdict: `SKIP` | `WATCH` | `CLAIMED` | `BLOCKED`
   - Task id, poster, escrow, rationale
   - Wallet readiness snapshot (AZL wallet and deposit balances if known)

6. **Notify** — on `CLAIMED` or high-value `WATCH`, `./notify` with one sentence + task id.

7. **Log** — append to `memory/logs/${today}.md`:

   ```
   ## azzle-worker
   - **taskId**: N
   - **Verdict**: SKIP | WATCH | CLAIMED | BLOCKED
   - **Note**: ...
   ```

## Constraints

- Never commit private keys. Use Bankr or GitHub secrets.
- After a worker claim, the poster must fully `fund` AZL escrow. Full funding transitions the task to `ACTIVE`; the worker then calls `markDelivered`.
- Do not use direct hire, milestones, proof submission, or USDC task payments; they are absent from V2.
- Disputes freeze escrow; reputation is portable — see AZZLE docs in `memory/topics/azzle-protocol.md`.
