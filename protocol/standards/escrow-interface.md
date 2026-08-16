# V2 escrow interface reference

The active interface is defined by [`EscrowVaultV2.sol`](../../contracts/src/v2/EscrowVaultV2.sol), not by a portable multi-mode standard.

Registry-authorized methods are `create`, `fund`, `release`, `close`, and `refund`. Arbitration-authorized methods are `freeze` and `settle(taskId, workerBps)`. Escrow states are `NONE, FUNDED, FROZEN, SETTLED`. All amounts are AZL wei; failed exact payouts may be deferred for pull claim.

Poster flow: approve the manifest's `escrowVault`, then call `taskRegistry.fund`. Do not call the vault directly. V2 has no escrow modes, milestones, streaming, or hour blocks.
