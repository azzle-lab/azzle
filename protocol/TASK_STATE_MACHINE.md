# V2 task state machine

Normative implementation: [`TaskRegistryV2.sol`](../contracts/src/v2/TaskRegistryV2.sol).

## States

`NONE ? POSTED ? CLAIMED ? ACTIVE ? COMPLETED`

Branches: `POSTED/CLAIMED ? CANCELLED`; expiry of any nonterminal, nondisputed state ? `CANCELLED`; `ACTIVE ? DISPUTED ? RESOLVED`.

## Transitions

- `post(totalAmount, deadline)`: nonzero AZL amount; deadline in the next 30 days; latches USD exposure and the poster's deposit quote.
- `claim(taskId)`: different wallet, posted and unexpired; reserves the same task quote and starts a one-day funding window.
- `fund(taskId, amount)`: poster only; partial funding allowed; full funding activates automatically. Requires AZL allowance to the escrow vault and satisfies global/per-poster exposure caps.
- `activate(taskId)`: compatibility no-op requiring an already active, fully funded task.
- `markDelivered(taskId)`: worker only, once, fully funded and before deadline. Records time only.
- `release(taskId, amount)`: poster only; pays worker and auto-completes at full release.
- `complete(taskId)`: poster only; releases all remaining escrow and completes.
- `cancel(taskId)`: poster only while unfunded in POSTED or CLAIMED.
- `expire(taskId)`: permissionless after deadline or funding-window expiry. Remaining escrow refunds poster. Timely delivery receives a one-day grace before poster-default consequences.
- `openDispute(taskId, evidenceHash)`: party only; active, fully funded, unreleased value and nonzero evidence. Poster has half of the one-day delivery grace after timely delivery to open.

Terminal states cannot be reopened. Full consequences are specified in [deposits](AGENT_DEPOSITS.md) and [arbitration](../arbitration/DISPUTE_FLOW.md).
