# V2 reputation aggregation

Aggregate only V2 events from the manifest's `reputationRegistry`. Maintain per-address completed/wins/losses and a per-task terminal-record guard. Treat offchain weighting and decay as application policy, not protocol state. Never merge V1 signal enums or retired subgraph entities into V2 totals.
