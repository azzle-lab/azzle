# Crowdfund poster

A crowdfund is a Safe. The Safe is the V2 task poster. Safe checks the signatures. A campaign module adds wallets and sets the pass count. The registry, escrow, and deposit vault are unchanged.

Code: [`contracts/src/crowdfund/`](../contracts/src/crowdfund/).

## Pass count

For `n` owners the pass count is `(3 * n + 4) / 5` (integer division). That is `ceil(3n/5)`.

| Owners | Signatures to pass |
| --- | --- |
| 1 | 1 |
| 2 | 2 |
| 3 | 2 |
| 4 | 3 |
| 5 | 3 |
| 10 | 6 |
| 100 | 60 |
| 200 | 120 |

The owner cap is 200, including the opener. A join raises the pass count by 1 unless the new total ends in 0, 3, 5, or 8. Those joins keep the previous count. At 200 owners the count is 120.

Safe checks signatures when the transaction executes, against the owners and the threshold at that moment. Signatures already collected stay valid after a join. If the join raises the count, execution waits until enough current owners have signed.

At 2 owners the schedule is 2 of 2. One lost key freezes owner transactions until a third wallet joins and the count becomes 2 of 3. `leave` cannot recover a key that can no longer sign.

## What gets deployed

`CrowdfundFactory.create` deploys one module, one module guard, and one Safe proxy. The Safe starts as the opener alone, threshold 1. Setup enables the module and the guard in that same transaction.

Both market factories are on Base. Read [`contracts/deployments/base-8453-crowdfund.json`](../contracts/deployments/base-8453-crowdfund.json) for standard and [`contracts/deployments/base-8453-micro-crowdfund.json`](../contracts/deployments/base-8453-micro-crowdfund.json) for micro at runtime. Do not copy the address into prose. `/crowdfund` calls `create`, `join`, `leave`, and `contribute`. It does not post the V2 task.

The factory is constructed with addresses read for the target chain:

- Safe's proxy factory
- Safe's L2 singleton (owner and threshold changes emit events)
- Safe's compatibility fallback handler
- the market's AZL token
- that market's `taskRegistry`

Do not copy those addresses into a deploy script from memory. On Base, use the singleton Safe publishes for chains that index events.

The module may only:

- `addOwnerWithThreshold` for the joiner, with threshold `(3 * (owners + 1) + 4) / 5`
- `removeOwner` for a wallet that is leaving, with the matching lower threshold
- `transfer` of AZL to a payee and amount the module just recorded

The guard reverts every other module call. Owner signatures are a separate path. A set of owners that meets the pass count can sign any Safe transaction, including an AZL transfer or disabling the guard. That is the crowdfund's authority over the poster account.

## Joining

The opener is owner 1 and starts with no task AZL. `contribute` lets an existing owner add AZL. `join` pulls AZL from a new wallet into the Safe and adds that wallet as an owner.

Both stop at `totalAmount`. The first payment from a wallet must be at least `minJoin`. Each wallet joins once. The opener sets `totalAmount` and `minJoin` at `create`.

`leave` is open until the campaign locks. It removes the owner, sets the new pass count, and returns that wallet's AZL. The last remaining owner cannot leave.

Call `syncFunded(taskId)` after the Safe's task is fully funded. Membership then freezes. If a join lands after funding and before `syncFunded`, that wallet `leave`s so the Safe's AZL balance is zero, then anyone calls `syncFunded`.

## Task actions

These are ordinary Safe transactions from [`CrowdfundCalls`](../contracts/src/crowdfund/CrowdfundCalls.sol), signed with Safe's EIP-712 `SafeTx` hash. Signatures are ordered by owner address. At a large owner set, collect them with Protocol Kit and submit one `execTransaction`. The Safe app is not the signing path for a campaign near 200 owners.

1. Before a second wallet joins, the opener seeds the poster deposit through the market `paymentGateway`, then a 1-of-1 transaction calls `taskRegistry.post(totalAmount, deadline)`. Check `paymentGateway.intakePaused()` first. The deposit sits in the deposit vault. Task AZL stays in the Safe.
2. Wallets join up to `totalAmount` and 200 owners. Do this before a worker claims. The registry funding window is one day after `claim`.
3. `fund` is a delegatecall to Safe's `MultiSendCallOnly`: approve `escrowVault` for `totalAmount`, call `taskRegistry.fund(taskId, totalAmount)`, then set the allowance back to zero. Escrow pulls AZL from the Safe because the Safe is the poster.
4. `syncFunded(taskId)` locks the member list. The registry task must show this Safe as poster, and `funded` must equal the campaign `totalAmount`.
5. Later Safe transactions call `release`, `complete`, `cancel`, or `openDispute(taskId, evidenceHash)`.

One campaign posts one task. `syncFunded` binds the first task id that matches this Safe and this amount.

## Refunds

Escrow refunds the poster, which is the Safe. After `expire`, `cancel` of an unfunded task is different: unfunded AZL never left the Safe, and `leave` still returns it until lock.

Once the task is `CANCELLED` or `RESOLVED` and the AZL is back on the Safe, `syncRefund(taskId)` records that balance. If the refund arrived before `syncFunded`, that call records it directly. Each wallet then `claim`s `contribution * refund / totalContribution`. Integer division can leave a wei of dust in the Safe.

A completed task pays the worker. `claim` then pays nothing.

## Agents

Board HTTP: `GET` / `POST` `/api/crowdfund-campaigns` (alias `/api/market/crowdfund`). POST `action` is `create`, `join`, `leave`, or `contribute`. The board stores title, brief, and names after the wallet tx lands. `join` and `contribute` pull AZL into the Safe. `leave` sends that wallet AZL back. A crowdfund is not a POSTED task until the Safe posts. Skill: [`.cursor/skills/azzle-crowdfund/SKILL.md`](../.cursor/skills/azzle-crowdfund/SKILL.md).

## Marketplace

Start a bounty at `/crowdfund`. The opener names the outcome, the goal in AZL, and the minimum join, then copies an invite link. Any wallet can take a seat. It does not have to be a team. The pass count on the card is `(3n + 4) / 5`, starting at 1 of 1. The interactive map is [`site/docs/crowdfund-explorer.html`](../site/docs/crowdfund-explorer.html).

Invite links use `/crowdfund?crowd=`. The open market is solo POSTED tasks only.

A pledge is AZL already in the Safe, or the opener's recorded share after `contribute`. It is not task escrow. The Safe still has to post and fund the task before a worker can claim it.

## Tests

From `contracts/`:

```
FOUNDRY_PROFILE=crowdfund forge test
```

The profile deploys Safe's singleton, proxy factory, fallback handler, and `MultiSendCallOnly` from `@safe-global/safe-smart-account` 1.5.0. It checks the pass count for every owner total from 1 through 200, and it walks a real Safe from 1 owner to 200.
