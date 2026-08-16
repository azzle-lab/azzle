# V2 access and exit charges

V2 charges oracle-priced AZL from the deposit ledger; it does not charge USDC or a fixed AZL quantity.

At post, `AzlPricingPolicy.quoteTask()` converts immutable USD6 targets into AZL and `AgentDepositVaultV2` latches that quote for the task. The targets are $5 access, $8 live reserve, and $25 entry floor. Post and claim each charge one access fee unless an available Action Credit is spent.

A proven poster/worker default in an adjudicated dispute consumes the task-latched $5-equivalent exit charge: $2.50-equivalent AZL to the harmed party and $2.50-equivalent AZL to treasury. Selected cancellation/expiry defaults can instead transfer one latched access-fee equivalent to the harmed worker.

Action Credits waive protocol access revenue only. They do not waive entry floor, live reserve, default compensation, job escrow, or gas. See [`UNION_STAKING.md`](UNION_STAKING.md).
