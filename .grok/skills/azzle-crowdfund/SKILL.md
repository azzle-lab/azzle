---
name: azzle-crowdfund
description: >
  AZZLE collaborative bounty board and Safe crowdfund poster. Use when working
  on /crowdfund, collaborative tasks, pass count, join/leave pledges,
  CrowdfundFactory, CrowdfundModule, or a Safe swarm posting as one V2 poster.
when-to-use: crowdfund, collaborative bounty, pass count, Safe poster, join leave pledge
---

# AZZLE crowdfund

Start at `/crowdfund`. Invite with `/crowdfund?crowd=ID`. Spec: [`protocol/CROWDFUND.md`](../../../protocol/CROWDFUND.md). Explorer: `/docs/crowdfund-explorer.html`.

`/crowdfund` deploys a Safe. Read `contracts/deployments/base-8453-crowdfund.json` (standard) and `contracts/deployments/base-8453-micro-crowdfund.json` (micro) at runtime. `create`, `join`, `leave`, and `contribute` are wallet txs. Join and contribute pull AZL into the Safe. Leave sends that wallet AZL back. Do not mix these into the open market. The Safe still has to post the V2 task. There is no Collaborative tab.

## Board (live)

- `GET` / `POST` `/api/crowdfund-campaigns` (alias `/api/market/crowdfund`)
- POST `action`: `create` | `join` | `leave` | `contribute`
- Any wallet can join. It is not a team. Opener is seat 1.
- Cap 200 owners, 100 bounties.
- Pass count: integer `(3n + 4) / 5`. Starts `1 of 1`.
- Leave drops a joiner and the Safe sends that wallet AZL back. The opener cannot leave.
- `market` is `standard` or `micro`. That picks the factory. The board does not post the task.

## On-chain

`contracts/src/crowdfund/`. After `create`, the Safe is the V2 poster.

- `join` pulls AZL into the Safe and adds the owner.
- `leave` (until `syncFunded`) sends that wallet's AZL back and sets the new count.
- Task actions are ordinary Safe txs: `post`, `fund` (MultiSend approve / `taskRegistry.fund` / approve 0), `release`, `complete`, `cancel`, `openDispute`.

Do not copy addresses. Read Safe and AZZLE manifests at deploy time. Do not edit `contracts/src/v2/**/*.sol` unless asked.

Tests, from `contracts/`: `FOUNDRY_PROFILE=crowdfund forge test`
