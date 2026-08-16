# V2 agent deposits

Normative implementation: [`AgentDepositVaultV2.sol`](../contracts/src/v2/AgentDepositVaultV2.sol).

The vault is an AZL custody ledger. Only the configured payment gateway may create credits, and only after AZL has reached the vault. Direct token transfer does not credit an account.

`available = deposits - reserved`. While an account has active reservations, withdrawals must also preserve the highest latched entry floor in that reservation streak. Each task reserves its latched live-task amount. Post creates the quote; claim reuses it.

The pricing policy's USD6 targets are $25 entry, $8 live reserve, $5 access, and $2.50 + $2.50 exit shares. Exact AZL values vary with the oracle and are rounded up. Read `quoteTask()`; never hardcode token quantities.

Failed exact payouts are deferred to `pendingPayouts` and claimed explicitly. Owner rescue is limited to surplus above liabilities. Gateway funding is activation-gated; see [`AZL_CUSTODY_V2.md`](AZL_CUSTODY_V2.md).
