# AZZLE on Bankr x402 Cloud

The standard paid, agent-discoverable interface for AZZLE live on-chain data:
(task discovery + reputation) as monetized HTTP APIs via
[Bankr x402 Cloud](https://bankr.bot/x402) — hosting, x402 payments, on-chain
USDC settlement, and agent discovery handled by Bankr.

> **Scope:** distribution / monetization layer for AZZLE *read* data and
> *unsigned write preparation*. It does **not** replace AZZLE access fees or
> job escrow — those settle on-chain via `TreasuryRouterV2` / `EscrowVaultV2`
> (see [`docs/X402_PAYMENTS.md`](../../docs/X402_PAYMENTS.md)). x402 payment
> never posts, claims, funds, deposits, or stakes; prepare endpoints return calldata to sign.
> No Bankr code lives in the smart contracts.

## Layout

This folder is a ready-to-deploy Bankr x402 project (`bankr x402 init` shape):

```
x402-cloud/
├── bankr.x402.json          # service config: price, methods, JSON schema
└── x402/
    ├── azzle-open-tasks/index.ts
    ├── azzle-task/index.ts
    ├── azzle-task-scope/index.ts
    ├── azzle-reputation/index.ts
    ├── azzle-leaderboard/index.ts
    ├── azzle-union-overview/index.ts
    ├── azzle-deposit-usdc/index.ts
    ├── azzle-post-task/index.ts
    ├── azzle-claim-task/index.ts
    ├── azzle-stake/index.ts
    ├── azzle-unstake/index.ts
    ├── azzle-bank-credits/index.ts
    └── azzle-claim-earnings/index.ts
```

Each `index.ts` is a **self-contained** `Request → response` handler (Bankr
uploads only that file). A generated dual-market manifest block is inlined by
`scripts/sync-manifest-surfaces.mjs` so handlers do not import sibling modules.
They return a `Response` (`application/json`) on every path — Bankr's runtime
does not auto-wrap plain objects. Service config declares `mimeType`, input/output
examples, and `extensions.bazaar` so x402 v2 scanners can index the resource.

## Endpoints

| Service | Returns | Price (USDC) | Params |
|---------|---------|-------------|--------|
| `azzle-open-tasks` | Tasks in `POSTED` state | $0.01 | `?market=standard\|micro&limit=1..100` |
| `azzle-task` | Single task by strict V2 ref | $0.01 | `?market=<market>&id=v2:<market>:<id>` |
| `azzle-task-scope` | Immutable public scope by strict V2 ref | $0.01 | `?market=<market>&id=v2:<market>:<id>` |
| `azzle-reputation` | Canonical counters and verifier bond | $0.05 | `?market=<market>&address=0x...` |
| `azzle-leaderboard` | Bounded agent / verifier ranking | $0.05 | `?market=<market>&kind=reputation\|verifiers&limit=` |
| `azzle-union-overview` | Union staking and credits state | $0.02 | `?market=standard\|micro` |
| `azzle-deposit-usdc` | Unsigned USDC deposit batch (`approve` + `fundWithUsdc`) | $0.10 | `market` + `exactUsdcIn` or `usdcAmount` |
| `azzle-post-task` | Unsigned `post()` batch to open a task (not the open-task list) | $0.15 | `market` + `totalAmount` + `durationSeconds` or `deadline` |
| `azzle-claim-task` | Unsigned `claim()` batch for a POSTED task | $0.10 | `market` + `id=v2:<market>:<id>` |
| `azzle-stake` | Unsigned Union stake batch (`approve` + `stake`) | $0.10 | `market` + `azlAmount` or `amountAzlWei` |
| `azzle-unstake` | Unsigned `unstake(amount, recipient)` (immediate AZL transfer) | $0.10 | `market` + recipient/`from` + amount, or `from` for full stake |
| `azzle-bank-credits` | Unsigned `bankCredits()` checkpoint | $0.05 | `market` |
| `azzle-claim-earnings` | Unsigned `claim` / `claimPayout` batch | $0.10 | `market` + `recipient` or `from` |

`market` is required on every service. Task-taking services accept only
`v2:standard:N` or `v2:micro:N`, and reject a task reference whose market does
not match the explicit `market` parameter. Each request reads one generated
canonical graph; list and leaderboard responses never merge markets.

`azzle-deposit-usdc`, `azzle-post-task`, `azzle-claim-task`, `azzle-stake`,
`azzle-unstake`, `azzle-bank-credits`, and `azzle-claim-earnings` accept GET query
params or a POST JSON body. They return unsigned `{ chainId: 8453, transactions }`
batches after live onchain checks. Paying for the call does **not** deposit USDC,
post a task, claim a task, stake, unstake, bank credits, or claim earnings — the
caller still signs on Base. `azzle-post-task` is the open-task *write*;
`azzle-open-tasks` is the POSTED-task *list*. V2 `unstake` transfers AZL
immediately; there is no unstake queue.

Leaderboard discovery scans at most 12,000 blocks and evaluates at most 250
event-discovered subjects against current contract views. Open-task listing reads
the newest 250 task ids. Responses expose the
block window, candidate cap, truncation flags, and a `complete` flag. Reputation
rows are ordered by canonical `completed`, `wins`, and `losses` counters;
verifier rows are ordered by current `bondAzlWei`.

Live Bankr URL after deploy: `https://x402.bankr.bot/<wallet>/<service>`.

**Bazaar / x402 scan URL** (v2 `resource` + `extensions.bazaar`):
`https://www.azzle.org/x402/<service>`
Example: `https://www.azzle.org/x402/azzle-open-tasks`

Bankr's hosted 402 omits those fields. Paste the azzle.org URL into the scanner, not the bankr.bot URL.

## Prerequisites

Use the **official** CLI — the npm package is `@bankr/cli` (the bare `bankr`
package is an unrelated squatter; uninstall it first if present):

```bash
npm uninstall -g bankr           # only if the wrong package is installed
npm install -g @bankr/cli
bankr --version                  # expect 0.3.x or newer
```

Authenticate (creates a wallet + API key):

```bash
bankr login                      # interactive menu, or:
bankr login email you@example.com            # step 1: sends OTP
bankr login email you@example.com --code 123456 --accept-terms   # step 2
bankr whoami                     # verify
```

## Go live

```bash
cd agents/x402-cloud

# optional: use a dedicated Base RPC provider
bankr x402 env set BASE_RPC_URL=https://mainnet.base.org

# deploy every service in bankr.x402.json (prices/schemas already configured)
# NOTE: batch deploy (`bankr x402 deploy` with no name) can return 403 on some
# accounts — deploy one service at a time if that happens:
bankr x402 deploy azzle-open-tasks
bankr x402 deploy azzle-task
bankr x402 deploy azzle-task-scope
bankr x402 deploy azzle-reputation
bankr x402 deploy azzle-leaderboard
bankr x402 deploy azzle-union-overview
bankr x402 deploy azzle-deposit-usdc
bankr x402 deploy azzle-post-task
bankr x402 deploy azzle-claim-task
bankr x402 deploy azzle-stake
bankr x402 deploy azzle-unstake
bankr x402 deploy azzle-bank-credits
bankr x402 deploy azzle-claim-earnings

bankr x402 list                  # confirm live URLs + versions
```

Manage after launch:

```bash
bankr x402 configure azzle-reputation   # tweak price/description interactively
bankr x402 revenue                       # earnings breakdown
bankr x402 pause azzle-open-tasks
bankr x402 resume azzle-open-tasks
bankr x402 delete azzle-task
```

## Test

```bash
# inspect the published schema (no auth, no payment)
bankr x402 schema https://x402.bankr.bot/<wallet>/azzle-open-tasks

# unpaid call → 402 + PaymentRequirements
curl -i "https://x402.bankr.bot/<wallet>/azzle-open-tasks?market=micro&limit=20"

# paid call with automatic USDC payment from your Bankr wallet
bankr x402 call "https://x402.bankr.bot/<wallet>/azzle-reputation?market=standard&address=<agent-address>"
bankr x402 call "https://x402.bankr.bot/<wallet>/azzle-task?market=micro&id=v2:micro:42"
bankr x402 call "https://x402.bankr.bot/<wallet>/azzle-task-scope?market=standard&id=v2:standard:42"
bankr x402 call "https://x402.bankr.bot/<wallet>/azzle-deposit-usdc" -X POST -d '{"market":"micro","usdcAmount":"10"}'
bankr x402 call "https://x402.bankr.bot/<wallet>/azzle-post-task" -X POST -d '{"market":"micro","totalAmount":"1000000000000000000","durationSeconds":604800}'
bankr x402 call "https://x402.bankr.bot/<wallet>/azzle-claim-task" -X POST -d '{"market":"micro","id":"v2:micro:42"}'
bankr x402 call "https://x402.bankr.bot/<wallet>/azzle-stake" -X POST -d '{"market":"micro","azlAmount":"10"}'
bankr x402 call "https://x402.bankr.bot/<wallet>/azzle-unstake" -X POST -d '{"market":"micro","from":"<wallet>"}'
bankr x402 call "https://x402.bankr.bot/<wallet>/azzle-bank-credits" -X POST -d '{"market":"micro"}'
bankr x402 call "https://x402.bankr.bot/<wallet>/azzle-claim-earnings" -X POST -d '{"market":"micro","from":"<wallet>"}'
```

Payments use **settle-after-response**: handlers return a non-2xx (and throw on
upstream failure) for bad input or upstream errors, so callers are **not**
charged for failed requests.

## Create / manage via chat (no CLI)

The Bankr agent can do the full lifecycle — endpoints are identical to
CLI-deployed ones. Example prompts:

```
deploy an x402 endpoint called azzle-open-tasks that returns AZZLE POSTED tasks for 0.01 USDC
change the price of my azzle-reputation endpoint to 0.05 USDC
show me the recent logs for my azzle-open-tasks endpoint
list my x402 endpoints
```

## Environment variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `BASE_RPC_URL` | Base JSON-RPC endpoint | `https://mainnet.base.org` |

Set via `bankr x402 env set KEY=VALUE` (encrypted at rest) — never through chat.
These endpoints need no secrets; Base public RPC is the default.

## Pricing in USDC

Endpoints settle in **USDC** on Base (`exact` / EIP-3009). `price` is USD
(0.01–0.15 per call). Do not set `tokenAddress` — Bankr defaults to USDC.

Each service also declares:

- `mimeType`: `application/json`
- `schema.input` / `schema.output` with example values
- `extensions.bazaar` (`info` + JSON Schema) so x402 v2 scanners can index the
  route without a self-hosted `bazaarResourceServerExtension`

Unpaid Bankr-hosted calls return HTTP 402. Bankr currently places `resource` /
`description` / `mimeType` on `accepts[0]` and does not copy `extensions.bazaar`
into that 402. Scan `https://www.azzle.org/x402/<service>` instead — that facade
rewrites Bankr's 402 into the v2 envelope (`resource.url`, `mimeType`,
`extensions.bazaar`).

The `bankr x402 configure` wizard prices in USDC. Edit `bankr.x402.json` and
redeploy with `bankr x402 deploy <name>` to change a price.

## Relationship to the existing gateway

| Layer | Where | Money flow |
|-------|-------|------------|
| V2 access fee (post/claim) | `AgentDepositVaultV2` + `TreasuryRouterV2` | Oracle-derived AZL with a $5 USD policy target; Action Credit may waive |
| Job payment | `EscrowVaultV2` | AZL escrow on-chain |
| **Read + unsigned-write monetization (this folder)** | **Bankr x402 Cloud** | **per-call USDC → your wallet** |

The free browser market uses first-party Base RPC routes; these endpoints are
the paid agent-native discovery interface.
