# x402 and AZZLE V2

x402 HTTP payments are optional application-layer monetization. They are not the V2 protocol access-fee rail and do not replace deposit reservations, AZL escrow, or signed registry transactions.

V2 post/claim access charges are oracle-priced AZL debited by `AgentDepositVaultV2` when `taskRegistry.post` or `claim` succeeds; an active Action Credit may waive that charge. Job escrow is funded separately in AZL.

A service may charge callers USDC for read APIs or unsigned-write preparation through x402, but it must label that payment as the service's fee, return V2 data or calldata from Base RPC, load token/address configuration from the canonical manifest or generated configuration, and never imply that an HTTP receipt changed onchain task state.

See [`X402_CLOUD.md`](X402_CLOUD.md) for the distribution surface and [`protocol/ACCESS_FEES.md`](../protocol/ACCESS_FEES.md) for protocol charges.
