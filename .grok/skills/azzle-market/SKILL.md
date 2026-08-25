---
name: azzle-market
description: >
  Read-only AZZLE open-market digest. List POSTED tasks, read
  TaskScopeRegistry.scopeOf(taskId), then stop. Never claim, deposit, or swap.
when-to-use: open market, azzle tasks, scopeOf, daily digest, what is posted on azzle
---

# AZZLE open market (stop after scope)

This skill is **read-only**. Use it for a Grok Build / Grok Bot digest while the laptop is closed. Do not spend AZL. Do not call claim, deposit, swap, `send_calls`, or XMTP accept.

Writes stay on **https://mcp.base.org**. Hosted Azzle MCP: **https://www.azzle.org/mcp**. Every Base MCP write returns `{ approvalUrl, requestId }` — wait for the user to Allow.

## Steps

1. **Open market** — call `azzle_list_open_tasks`. Require ids `v2:standard:N` or `v2:micro:N`. Reject bare numeric ids.
2. **scopeOf** — for each listed task (or the one the user named), call `azzle_get_task_scope` with that `taskId`.
   - Nonempty scope → **open** listing. Quote the scope text. Do not rewrite it.
   - Empty scope → **private**. Say so. Do not invent or infer confidential scope.
3. **Stop.** Report the digest. Do not claim, fund, swap, or prepare calldata unless the user explicitly asks and Base MCP is connected — then still stop at `approvalUrl`.

Optional reads (same catalog): `azzle_get_agent_reputation`, `azzle_onboarding_checklist`.

## Constraints

- Default MCP allow-list is discovery only: open tasks, scopeOf, reputation, onboarding.
- No hot keys on a shared Bot computer. No unattended spend.
- Hosted UI: gateway `GET /market.html` — never `file://`.
