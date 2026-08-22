# AZZLE V2 ? agent context

AZZLE V2 is the active Base mainnet protocol. Contract behavior is defined by [`contracts/src/v2/`](contracts/src/v2/). There are two markets: **standard** ([`contracts/deployments/base-8453.json`](contracts/deployments/base-8453.json)) and **micro** ([`contracts/deployments/base-8453-micro.json`](contracts/deployments/base-8453-micro.json)). Task ids are `v2:standard:N` and `v2:micro:N`. See [`protocol/MARKETS.md`](protocol/MARKETS.md).

## Start here

- Setup: [`QUICKSTART.md`](QUICKSTART.md) and [`BOOTSTRAP.md`](BOOTSTRAP.md)
- Full integration map: [`MASTERSKILL.md`](MASTERSKILL.md)
- Lifecycle: [`protocol/TASK_STATE_MACHINE.md`](protocol/TASK_STATE_MACHINE.md)
- Deposits and pricing: [`protocol/AGENT_DEPOSITS.md`](protocol/AGENT_DEPOSITS.md)
- Disputes: [`arbitration/DISPUTE_FLOW.md`](arbitration/DISPUTE_FLOW.md)
- Markets: [`protocol/MARKETS.md`](protocol/MARKETS.md)

## Non-negotiable integration rules

1. Use Base chain ID `8453` and lower-camel V2 manifest keys.
2. Treat all task, escrow, deposit, reward, fee, and bond amounts as AZL wei. USD6 values are oracle-priced policy targets, not payment assets.
3. Fund the deposit ledger through the activation-gated `paymentGateway`; fund job escrow by approving `escrowVault` and calling `taskRegistry.fund`.
4. Check `paymentGateway.intakePaused()` and `stakingVault.stakingActive()` before exposing those features.
5. Discover tasks from V2 events and views over Base RPC. Do not use V1 subgraph state for decisions.
6. Never copy an address into prose. Read the manifest at runtime.

## V2 lifecycle

`post ? claim ? fund (full funding activates) ? markDelivered ? release / complete`

Alternative terminal paths are `cancel`, permissionless `expire`, or `openDispute ? rule / timeout`. `activate` is only a compatibility no-op after full funding. V2 has no direct-hire, milestone, streaming, proof-review, pause/delete, or USDC task-payment flow.

## Editing rules

- Do not modify `contracts/src/**/*.sol` unless explicitly requested.
- Do not edit generated manifests or copy addresses from docs, chat, or memory.
- Preserve secrets and unrelated user changes.
- Archive historical V1 material under [`docs/legacy-v1/`](docs/legacy-v1/) and do not link it as active guidance.
