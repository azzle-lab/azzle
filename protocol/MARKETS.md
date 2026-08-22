# AZZLE markets

AZZLE protocol V2 is one Solidity surface in [`contracts/src/v2/`](../contracts/src/v2/). **Markets** are separately deployed graphs of that surface on Base. Do not call micro “V2.1” or “V3”.

| Market | Manifest | Task ids | USD posting floor (haircut quote) |
| --- | --- | --- | --- |
| `standard` | [`contracts/deployments/base-8453.json`](../contracts/deployments/base-8453.json) | `v2:standard:N` | $45 |
| `micro` | [`contracts/deployments/base-8453-micro.json`](../contracts/deployments/base-8453-micro.json) | `v2:micro:N` | $5 |

Unscoped `v2:N` ids are illegal.

## Shared vs isolated

Both markets read the **same** live `observationOracle`, `twapAdapter`, and `usdOracle` (20% haircut, TWAP, `rollReference`). Both fail closed if TWAP is stale. Shared externals: AZL, USDC, WETH, pool, ETH/USD feed.

Not shared: deposit vault, registry, escrow, gateway, staking, treasury, reputation, bonds, arbitration, scope, executor/legs. Credits, reputation, and escrow do **not** cross. Each Union vault `setRegistry` is one-shot, so site staking is two `stake()` calls.

## Policy knobs

Standard (live, unchanged): $25 entry / $8 live / $5 access / $2.50+$2.50 exit; $10,000 max task and global book; $500 USDC / 10 ETH gateway caps; 600k credit cap, 1 credit per 100M AZL / 30d; 10k AZL verifier bond.

Micro: $3 entry / $1 live / $0.50 access / $0.25+$0.25 exit; $50 max task; $2,500 global book (20% poster cap → $500); ~$100 USDC / 0.05 ETH gateway caps; 6M credit cap, 1 credit per 10M AZL / 30d; 1k AZL verifier bond (10% slash in order of a $50 dispute). Site floor is `quoteUsdForAzl(deposits) >= 5e6`, not “send $5 USDC”.

## Integration

- `AzzleV2Client(loadMarketManifest(market), rpcUrl)` with `market` default `standard`.
- HTTP discovery takes `?market=standard|micro` and never merges lists.
- Posting quota keys `market + address`.
- Bankr/x402 stay on standard unless a micro market is named.
- Micro deploy injects live oracle addresses; it does not redeploy TWAP.

See [`AGENTS.md`](../AGENTS.md) and [`MASTERSKILL.md`](../MASTERSKILL.md).
