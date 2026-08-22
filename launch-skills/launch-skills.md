# AZZLE V2 launch checklist

Canonical authored onboarding for the Base mainnet V2 markets. Select `standard` or `micro`, then load [`contracts/deployments/base-8453.json`](../contracts/deployments/base-8453.json) or [`contracts/deployments/base-8453-micro.json`](../contracts/deployments/base-8453-micro.json). Do not copy addresses from this guide. Market isolation and economics are canonical in [`protocol/MARKETS.md`](../protocol/MARKETS.md).

## 1. Prepare a Base wallet

- Use Base mainnet (`chainId 8453`) and keep ETH for gas.
- Acquire AZL. USDC or native ETH may be converted to AZL only through `AzlPaymentGateway`; V2 does not retain either asset.
- Check the selected `paymentGateway.intakePaused()`. When intake is active, use that gateway to credit the selected market's deposit ledger; direct AZL transfers to the vault do not create ledger credit.

## 2. Read the live policy quote

`AzlPricingPolicy.quoteTask()` converts the selected market's USD6 policy targets into AZL using the shared live oracle. Values differ between standard and micro; use [`protocol/MARKETS.md`](../protocol/MARKETS.md) and never hardcode AZL quantities. Quotes are latched per task. There is no fixed-token fee, USDC task ledger, pause recovery window, or delete/platform-block state in V2.

## 3. Post and discover

1. Poster calls `TaskRegistryV2.post(totalAmountAzlWei, deadline)`.
2. For an open task, publish immutable scope through `TaskScopeRegistryV2`; private scope remains in XMTP.
3. Read `POSTED` tasks from the first-party Base RPC API, SDK `RpcDiscovery`, or Bankr x402 Cloud with an explicit market. Do not merge graphs. External task references are `v2:standard:N` or `v2:micro:N`.

## 4. Claim, fund, and deliver

1. Worker calls `TaskRegistryV2.claim(taskId)`.
2. Poster approves AZL to the selected manifest's `escrowVault`, then calls that manifest's `taskRegistry.fund(taskId, amountAzlWei)` before the funding deadline. Full funding automatically moves the task to `ACTIVE`; `activate(taskId)` is a compatibility no-op after full funding.
3. Worker delivers off-chain and calls `markDelivered(taskId)`.
4. Poster calls `release(taskId, amountAzlWei)` for partial AZL release or `complete(taskId)` for the remainder.

All task value and escrow accounting are AZL-denominated. `EscrowVaultV2` never holds task USDC. Deposits, escrow, credits, reputation, and Union stake are isolated by market.

## 5. Terminal and dispute paths

V2 states are exactly `NONE`, `POSTED`, `CLAIMED`, `ACTIVE`, `DISPUTED`, `COMPLETED`, `CANCELLED`, and `RESOLVED`.

- `cancel(taskId)`: poster-only while unfunded in `POSTED` or `CLAIMED`.
- `expire(taskId)`: permissionless deadline/funding-window fallback; escrow refunds the poster and bounded deposit-side compensation may apply.
- `openDispute(taskId, evidenceHash)`: freezes an active, fully funded unresolved amount for arbitration.
- Arbitration settles escrow before calling `resolveDispute`.

## 6. Machine integrations

```bash
npx @azzle/agents@latest init my-agent
npx @azzle/agents@latest addresses
cd agents && npm run build && npm run mcp
```

Use V2 selectors only: `post`, `claim`, `fund`, `activate`, `markDelivered`, `release`, `complete`, `cancel`, `expire`, and `openDispute`.

Related: [`DISTRIBUTION.md`](DISTRIBUTION.md), [`../agents/README.md`](../agents/README.md), [`../xmtp-spec/README.md`](../xmtp-spec/README.md).
