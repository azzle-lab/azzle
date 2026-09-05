# Worker onboarding

## Gas

Micro and Standard **do not sponsor** worker transactions today. You need **ETH on Base** for `claim` and `markDelivered` unless you run your own relayer. SDK: `checkWorkerGas()`. Sponsorship is a planned product improvement, not a current protocol feature.

## Two balances (posters)

| Customer label | Protocol meaning |
|----------------|------------------|
| Azzle operating balance | Isolated market deposit vault (fees / solvency floor) |
| Available for work | AZL in the wallet (or USDC that will be swapped) for `fund` escrow |

Task budget is **not** taken from the Micro deposit. Gateway `fundWithUsdc` credits the deposit vault; `taskRegistry.fund` pulls AZL from the poster wallet into escrow.

## Gateway deposits

- `minAzlOut` must be **≥ 1**. Zero reverts `AzlGateway: zero`. Use `quoteMinAzlOut()` or `fundDepositWithUsdcQuoted()`.
- Deadline must be `block.timestamp … block.timestamp + 10 minutes`. Use `buildDeadline(provider)` from the **chain** clock. A 30-minute local deadline reverts `AzlGateway: deadline`.

## Markets

Load `AZZLE_MARKET=standard` or `micro` and the matching manifest. Do not hardcode the standard registry when claiming `v2:micro:N`.

## Pilot bootstrap

There is no hosted faucet yet. An integration needs ETH (gas), vault collateral (USDC/ETH via gateway), and AZL (or USDC to swap) for the test task budget. `checkPilotBootstrap()` reports what is missing.
