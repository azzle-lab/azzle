---
name: azzle-crowdfund
description: >
  AZZLE collaborative bounty board and Safe crowdfund poster. Use when working
  on /crowdfund, collaborative tasks, pass count, join/leave pledges,
  CrowdfundFactory, CrowdfundModule, or a Safe swarm posting as one V2 poster.
---

# AZZLE crowdfund

Start at `/crowdfund`. Invite with `/crowdfund?crowd=ID`. Spec: [`protocol/CROWDFUND.md`](../../../protocol/CROWDFUND.md). Explorer: `/docs/crowdfund-explorer.html`.

`/crowdfund` is a roster. `CrowdfundFactory` is not deployed on Base. A pledge is a recorded amount. Do not say AZL moved. Do not mix rosters into solo POSTED lists. Do not call `CrowdfundFactory.create` unless the user explicitly asks to deploy.

## Board (live)

- `GET` / `POST` `/api/crowdfund-campaigns` (alias `/api/market/crowdfund`)
- POST `action`: `create` | `join` | `leave`
- Any wallet can join. It is not a team. Opener is seat 1.
- Cap 200 owners, 100 bounties.
- Pass count: integer `(3n + 4) / 5`. Starts `1 of 1`.
- Leave drops a joiner from the roster. The opener cannot leave. No AZL moves on the board.
- `market` is `standard` or `micro` as a label. The board does not post the task.

## On-chain (code exists, factory not live)

`contracts/src/crowdfund/`. After `create`, the Safe is the V2 poster.

- `join` pulls AZL into the Safe and adds the owner.
- `leave` (until `syncFunded`) sends that wallet's AZL back and sets the new count.
- Task actions are ordinary Safe txs: `post`, `fund` (MultiSend approve / `taskRegistry.fund` / approve 0), `release`, `complete`, `cancel`, `openDispute`.

Do not copy addresses. Read Safe and AZZLE manifests at deploy time. Do not edit `contracts/src/v2/**/*.sol` unless asked.

Tests, from `contracts/`: `FOUNDRY_PROFILE=crowdfund forge test`
