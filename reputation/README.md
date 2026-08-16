# V2 reputation

Normative implementation: [`ReputationRegistryV2.sol`](../contracts/src/v2/ReputationRegistryV2.sol).

For each address the contract stores only three uint64 counters: `completed`, `wins`, and `losses`. Completion increments both parties. A nonneutral dispute increments the winner and loser; split and mutual outcomes are neutral. A poster expiry after timely delivery records a poster loss. Arbitration timeout emits an unresolved-dispute event and increments the poster's loss before the neutral terminal record.

One terminal record is permitted per task, except the unresolved signal intentionally does not consume that slot. Weighted scores, endorsement types, verifier attestations, decay, and arbitrator reputation tiers are not V2 onchain behavior. Consumers may derive metrics but must label them as offchain policy.
