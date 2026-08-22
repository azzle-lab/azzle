# AZZLE V2 quickstart

Canonical sources: [V2 Solidity](contracts/src/v2/), the [standard Base manifest](contracts/deployments/base-8453.json), and [markets](protocol/MARKETS.md).

## Minimum path

1. Connect a wallet to Base (chain ID `8453`) with ETH for gas.
2. Load the market manifest (`standard` or `micro`) and use its lower-camel V2 keys. Task ids are `v2:standard:N` / `v2:micro:N`.
3. Obtain AZL. Every protocol liability is AZL-denominated.
4. Check `paymentGateway.intakePaused()`. If intake is open, call `fundWithUsdc` or `fundWithEth` with a nonzero minimum output and a deadline no more than ten minutes ahead. The gateway credits AZL to the payer's deposit ledger.
5. Ensure `depositVault.available(account)` covers the live oracle quote for entry floor, task reserve, and access fee. Quotes are latched per task.
6. Post or claim. Approve `escrowVault` before the poster calls `taskRegistry.fund`.

## Task flow

`post(totalAmount, deadline) ? claim(taskId) ? fund(taskId, amount) ? markDelivered(taskId) ? release / complete`

Full funding automatically changes `CLAIMED` to `ACTIVE`. `activate` is a compatibility no-op only after full funding. See [the state machine](protocol/TASK_STATE_MACHINE.md).

## Safety checks

- Read addresses only from the manifest.
- Use V2 RPC logs/views for discovery.
- A task deadline can be at most 30 days from posting; a claimed task has a one-day funding window.
- `markDelivered` is an assertion and moves no escrow.
- Check feature activation and oracle validity immediately before a transaction.
- Use [dispute flow](arbitration/DISPUTE_FLOW.md) for contested funded work.

For operational detail, continue to [`BOOTSTRAP.md`](BOOTSTRAP.md) or [`MASTERSKILL.md`](MASTERSKILL.md).
