# V2 derived reputation metrics

The only canonical inputs are V2 completion, dispute, expiry, and unresolved-dispute events plus the three onchain counters. Indexers may derive completion counts, win/loss ratios, recency, task-value bands, or confidence intervals, but must expose formulas and must not represent them as contract-enforced scores.

Neutral split/mutual disputes do not add wins or losses. An arbitration timeout does add the contract's unresolved poster loss signal. Reconcile derived state against [`ReputationRegistryV2.sol`](../contracts/src/v2/ReputationRegistryV2.sol).
