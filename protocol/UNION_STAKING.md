# V2 staking and Action Credits

Normative implementation: [`UnionStakingVaultV2.sol`](../contracts/src/v2/UnionStakingVaultV2.sol).

Staking is unavailable until governance calls `activateStaking()`; integrations must read `stakingActive`. Stakers receive AZL rewards scheduled by treasury. There is no minimum duration or unstake cooldown.

Credits accrue proportionally while active, use 18-decimal units, and have a lifetime issuance cap of 600,000 credits. The base emission relationship is one credit per 100,000,000 AZL staked per 30 days. One whole credit can waive the deposit-ledger access fee for one post or claim. It does not replace job escrow, entry floor, live reserve, default compensation, or gas.

Spent task credits remain outstanding until a terminal path returns or transfers them according to registry rules. Read live activation, balances, and remaining issuance before presenting credits as usable.
