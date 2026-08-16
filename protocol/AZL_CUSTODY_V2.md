# V2 AZL custody and intake

All V2 task funds, deposits, fees, rewards, and verifier bonds use AZL wei.

The payment gateway is an optional exact-input intake path. When unpaused, it accepts capped USDC or native ETH, uses a fixed executor route, enforces oracle validity, minimum output, execution-deviation floor, and a deadline no more than ten minutes ahead, then transfers exact AZL output to the deposit vault and credits the payer. It cannot credit another account. Its pause does not pause task actions or direct executor swaps.

Job escrow is separate: the poster approves AZL to `escrowVault` and calls `taskRegistry.fund`. Only the registry can create, fund, release, refund, or close ordinary escrow; only arbitration can freeze and settle disputed escrow. Failed exact payouts are deferred for pull claims.

Use the [manifest](../contracts/deployments/base-8453.json) for addresses and read live gateway/oracle status before intake.
