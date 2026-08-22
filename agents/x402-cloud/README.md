# AZZLE on Bankr x402 Cloud

The standard paid, agent-discoverable interface for AZZLE live on-chain data:
(task discovery + reputation) as monetized HTTP APIs via
[Bankr x402 Cloud](https://bankr.bot/x402) — hosting, x402 payments, on-chain
AZZLE settlement, and agent discovery handled by Bankr.

> **Scope:** distribution / monetization layer for AZZLE *read* data. It does
> **not** replace AZZLE access fees or job escrow — those settle on-chain via
> `TreasuryRouterV2` / `EscrowVaultV2` (see [`docs/X402_PAYMENTS.md`](../../docs/X402_PAYMENTS.md)).
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
    └── azzle-union-overview/index.ts
```

Each `index.ts` is a **self-contained** `Request → response` handler (Bankr
bundles per service). Handlers import only the generated dual-market manifest
selector and otherwise make direct Base RPC reads. They return plain objects
(auto-wrapped as JSON) or a full `Response` for non-2xx cases.

## Endpoints

| Service | Returns | Price (AZL) | Params |
|---------|---------|-------------|--------|
| `azzle-open-tasks` | Tasks in `POSTED` state | 100 | `?market=standard\|micro&limit=1..100` |
| `azzle-task` | Single task by strict V2 ref | 100 | `?market=<market>&id=v2:<market>:<id>` |
| `azzle-task-scope` | Immutable public scope by strict V2 ref | 100 | `?market=<market>&id=v2:<market>:<id>` |
| `azzle-reputation` | Canonical counters and verifier bond | 200 | `?market=<market>&address=0x...` |
| `azzle-leaderboard` | Bounded agent / verifier ranking | 200 | `?market=<market>&kind=reputation\|verifiers&limit=` |
| `azzle-union-overview` | Union staking and credits state | 100 | `?market=standard\|micro` |

`market` is required on every service. Task-taking services accept only
`v2:standard:N` or `v2:micro:N`, and reject a task reference whose market does
not match the explicit `market` parameter. Each request reads one generated
canonical graph; list and leaderboard responses never merge markets.

Leaderboard discovery scans at most 50,000 blocks and evaluates at most 250
event-discovered subjects against current contract views. Responses expose the
block window, candidate cap, truncation flags, and a `complete` flag. Reputation
rows are ordered by canonical `completed`, `wins`, and `losses` counters;
verifier rows are ordered by current `bondAzlWei`.

Live URL after deploy: `https://x402.bankr.bot/<wallet>/<service>`.

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

# paid call with automatic AZZLE payment from your Bankr wallet
bankr x402 call "https://x402.bankr.bot/<wallet>/azzle-reputation?market=standard&address=<agent-address>"
bankr x402 call "https://x402.bankr.bot/<wallet>/azzle-task?market=micro&id=v2:micro:42"
bankr x402 call "https://x402.bankr.bot/<wallet>/azzle-task-scope?market=standard&id=v2:standard:42"
```

Payments use **settle-after-response**: handlers return a non-2xx (and throw on
upstream failure) for bad input or upstream errors, so callers are **not**
charged for failed requests.

## Create / manage via chat (no CLI)

The Bankr agent can do the full lifecycle — endpoints are identical to
CLI-deployed ones. Example prompts:

```
deploy an x402 endpoint called azzle-open-tasks that returns AZZLE POSTED tasks for 100 AZZLE
change the price of my azzle-reputation endpoint to 500 AZZLE
show me the recent logs for my azzle-open-tasks endpoint
list my x402 endpoints
```

## Environment variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `BASE_RPC_URL` | Base JSON-RPC endpoint | `https://mainnet.base.org` |

Set via `bankr x402 env set KEY=VALUE` (encrypted at rest) — never through chat.
These endpoints need no secrets; Base public RPC is the default.

## Pricing in AZZLE

Endpoints settle in **AZL** on Base, not USDC.
Set `tokenAddress` and `currency` on **each service** in `bankr.x402.json` (top-level
alone is not applied at deploy). `price` is token units, not USD — see Bankr
[Custom Tokens](https://docs.bankr.bot/x402-cloud/custom-tokens):

The sync script derives each service's token address from the canonical
manifest. Do not hand-copy deployment addresses into this README or service
handlers.

AZL uses **Permit2** (not EIP-3009 like USDC). A payer's first call requires a
one-time on-chain Permit2 approval; subsequent payments are gasless signed
transfers. x402 clients read `asset` and `extra.assetTransferMethod` from the 402
response automatically — no client-side token config needed.

To switch back to USDC for a service, remove `tokenAddress` and redeploy. The
`bankr x402 configure` wizard always sets USDC — edit `bankr.x402.json`
directly for custom tokens, then `bankr x402 deploy <name>`.

## Relationship to the existing gateway

| Layer | Where | Money flow |
|-------|-------|------------|
| V2 access fee (post/claim) | `AgentDepositVaultV2` + `TreasuryRouterV2` | Oracle-derived AZL with a $5 USD policy target; Action Credit may waive |
| Job payment | `EscrowVaultV2` | AZL escrow on-chain |
| **Read-data monetization (this folder)** | **Bankr x402 Cloud** | **per-call AZZLE → your wallet** |

The free browser market uses first-party Base RPC routes; these endpoints are
the paid agent-native discovery interface.
