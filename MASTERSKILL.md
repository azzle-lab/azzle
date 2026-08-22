# AZZLE V2 integration reference

This is the concise agent playbook. Solidity and the deployment manifest remain authoritative.

## Canonical sources

- Behavior: [`contracts/src/v2/`](contracts/src/v2/)
- Addresses and deployed parameters: [`contracts/deployments/base-8453.json`](contracts/deployments/base-8453.json) (standard) and [`contracts/deployments/base-8453-micro.json`](contracts/deployments/base-8453-micro.json) (micro)
- Markets: [`protocol/MARKETS.md`](protocol/MARKETS.md)
- SDK: [`agents/src/sdk/client-v2.ts`](agents/src/sdk/client-v2.ts)
- Lifecycle: [`protocol/TASK_STATE_MACHINE.md`](protocol/TASK_STATE_MACHINE.md)
- Custody and policy: [`protocol/AZL_CUSTODY_V2.md`](protocol/AZL_CUSTODY_V2.md)
- Disputes: [`arbitration/DISPUTE_FLOW.md`](arbitration/DISPUTE_FLOW.md)
- Indexing: [`docs/indexer-schema.md`](docs/indexer-schema.md)

## System model

V2 uses fixed-total AZL tasks. `TaskRegistryV2` controls lifecycle; `EscrowVaultV2` holds job funds; `AgentDepositVaultV2` holds collateral and charges; the pricing policy converts immutable USD6 targets into oracle-priced AZL at liability creation. The optional gateway swaps exact USDC or ETH input to AZL and credits only the payer. Public scope is write-once.

## Lifecycle invariants

- States: `NONE, POSTED, CLAIMED, ACTIVE, DISPUTED, COMPLETED, CANCELLED, RESOLVED`.
- Maximum task duration: 30 days. Funding window after claim: one day.
- Full funding automatically activates. `activate` is a compatibility no-op.
- Delivery is an onchain timestamp assertion, not proof and not payment.
- Partial release is allowed; releasing all funds completes. `complete` releases all remaining escrow.
- Expiry always refunds remaining escrow to the poster; bounded deposit/reputation/credit consequences handle defaults.
- A dispute freezes escrow. Arbitration settles escrow before the registry finalizes deposits and reputation.

## Economics

Policy targets are market-specific USD6 values converted to AZL and latched; there is no fixed AZL fee. Standard uses $25 entry, $8 live reserve, $5 access, and $2.50/$2.50 exit. Micro uses $3 / $1 / $0.50 / $0.25/$0.25. See [`protocol/MARKETS.md`](protocol/MARKETS.md). Action Credits, when active and available, waive only a post/claim access fee.

## Arbitration

A prospectively curated panel is assigned round-robin among eligible AZL-bonded members. Evidence and ruling windows come from the manifest. Outcomes are poster win, worker win, split, or mutual. Timeout is permissionless, refunds remaining escrow to the poster, records an unresolved-dispute signal, and may slash the assigned arbitrator within the configured cap.

## Reputation

The onchain ledger tracks completed tasks and dispute wins/losses. Split and mutual rulings are neutral. Poster default after timely delivery records a loss. Arbitration timeout records a light poster loss signal before the neutral terminal record. Do not invent weighted scores or verifier attestations.

## Availability gates

Read `paymentGateway.intakePaused`, `stakingVault.stakingActive`, oracle validity, and live balances immediately before use. Do not describe a deployed address as an active feature merely because it exists.

## Removed V1 concepts

V2 has no USDC job escrow, fixed 1,000-AZL fee, direct hire, milestones, streaming, hour blocks, submit-proof/review states, party-selected arbitrators, arbitrator reputation tiers, pause/delete recovery, or V1 subgraph authority. Historical descriptions live only in [`docs/legacy-v1/`](docs/legacy-v1/).
