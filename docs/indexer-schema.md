# V2 RPC indexer schema

Source addresses come only from the market manifest: [`contracts/deployments/base-8453.json`](../contracts/deployments/base-8453.json) (standard) or [`contracts/deployments/base-8453-micro.json`](../contracts/deployments/base-8453-micro.json) (micro). Index from the manifest deployment block, key entities by **chain ID + registry + task ID**, and treat chain reads as authoritative. External task ids are `v2:standard:N` or `v2:micro:N`.

## Task events

`TaskPosted(taskId, poster, totalAmount, amountUsd6, deadline)`, `TaskClaimed`, `TaskFunded`, `TaskActivated`, `TaskDelivered`, `TaskReleased`, `TaskCompleted`, `TaskCancelled`, `TaskDisputed`, `TaskResolved`, and `ActionCreditUsed`.

Store poster, worker, AZL total/funded/released, declared and funded USD6 basis, deadline, funding deadline, delivery time, state, resolution, and transaction coordinates. Reconcile with `tasks`, `taskState`, and resolution mappings.

## Related events

- Scope: `ScopePublished(taskId, scopeHash, scope)`.
- Escrow: created, funded, released, refunded, frozen, deferred/claimed payouts.
- Deposits: credited, withdrawn, reserved/released, access/exit debits, deferred/claimed payouts.
- Arbitration: dispute opened, assignment, evidence, ruling phase, ruling, slash.
- Reputation: completion, dispute, poster expiry, unresolved dispute.
- Staking: activation, stake/unstake, rewards, credits.

Derived open-task queries should include only current POSTED state and must revalidate deadline and state before writes. V1 subgraph entities and event signatures must not be merged into this schema.
