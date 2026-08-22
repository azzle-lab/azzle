# V2 Payment Gateway — USDC / ETH Intake

V2 does not use the legacy agent-deposit top-up flow. Select `standard` or
`micro`, load that market's manifest, and check `paymentGateway.intakePaused()`.
When intake is active, the gateway converts USDC or native ETH into AZL and
credits only that market's deposit ledger. It does not fund task escrow.

## Thresholds

| Threshold | Amount | When |
|-----------|--------|------|
| **Task amount** | AZL wei | Set at `post` and bounded by `fund` |
| **Gas** | Base ETH | Required for registry and gateway transactions |

## Contracts (Base 8453)

Read `paymentGateway`, `taskRegistry`, `escrowVault`, and `external.usdc` from
the selected `base-8453.json` or `base-8453-micro.json` manifest; never copy
addresses into templates. See `protocol/MARKETS.md` for market policy.

## Step 1 — Fund with USDC

```solidity
// USDC has 6 decimals.
paymentGateway.fundWithUsdc(exactUsdcIn, minAzlOut, deadline);
```

## Step 2 — Fund with native ETH

```solidity
paymentGateway.fundWithEth{value: exactEthIn}(minAzlOut, deadline);
```

## Step 3 — Fund task escrow separately

Approve AZL to the selected manifest's `escrowVault`, then call
`taskRegistry.fund(localTaskId, amountAzlWei)`.

## Step 4 — Verify

```solidity
taskRegistry.tasks(localTaskId); // totalAmount and funded are AZL wei
taskRegistry.taskState(localTaskId); // current V2 state
```

All active task reads use Base RPC and are scoped to one registry. Publish task
references as `v2:standard:N` or `v2:micro:N`; there is no V2 task pause or
emergency-top-up recovery flow.

## Bankr agent commands

```
fund V2 AZL deposit with USDC on base
```

## Related
- `protocol/TASK_STATE_MACHINE.md` — V2 lifecycle and AZL amounts
- `protocol/TASK_DISCOVERY.md` — open/private scope discovery
- `launch-skills/launch-skills.md` — full onboarding phases
