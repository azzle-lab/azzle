# V2 source of truth

This is the concise authored reference for AZZLE V2. It is derived from [`contracts/src/v2/**/*.sol`](../contracts/src/v2/), both active deployment manifests, and the canonical market specification in [`protocol/MARKETS.md`](../protocol/MARKETS.md).

## Authority and deployment identity

Use this order when sources disagree:

1. Deployed contract behavior on Base (`chainId` `8453`), as defined by the V2 Solidity sources.
2. The selected market manifest: [`base-8453.json`](../contracts/deployments/base-8453.json) for `standard` or [`base-8453-micro.json`](../contracts/deployments/base-8453-micro.json) for `micro`.
3. This document, which summarizes those two sources and is not an independent protocol definition.

Select a market before loading addresses. The manifest address keys are lower-camel: `deployer`, `governance`, `factory`, `treasuryRouter`, `observationOracle`, `twapAdapter`, `usdOracle`, `pricingPolicy`, `depositVault`, `escrowVault`, `reputationRegistry`, `verifierBondVault`, `stakingVault`, `taskRegistry`, `arbitrationModule`, `usdcWethLeg`, `exactInputExecutor`, `paymentGateway`, `taskScopeRegistry`; external keys are `chainId`, `usdc`, `weth`, `azl`, `poolManager`, `universalRouter`, `hook`, `ethUsdFeed`, `poolId`. Address values are intentionally not repeated here.

The two markets are separate deployment graphs. Escrow, deposits, credits, reputation, Union stake and rewards, treasury, bonds, arbitration, scope, and registry state do not cross. Only the oracle stack and external assets are shared. Protocol task references are strictly `v2:standard:N` and `v2:micro:N`; `v2:N` and bare numeric identifiers are not valid cross-surface references. HTTP discovery selects one graph with `market=standard|micro` and never merges results.

`actionCredits.activationRequired: true` is deployment metadata consistent with [`UnionStakingVaultV2`](../contracts/src/v2/UnionStakingVaultV2.sol) starting with `stakingActive == false` and requiring owner `activateStaking()`. It does **not** prove the current live state. This document performed no RPC read; integrations must read `stakingActive()` (and gateway `intakePaused()`) onchain before presenting availability. Factory finalization requires gateway intake to be paused, but governance can later change it.

## Tokens, units, pricing, and timing

- AZL amounts use 18-decimal token wei. Task commitments, escrow, agent deposits, access/exit charges, verifier bonds, staking, rewards, and treasury accounting are AZL-only.
- USD policy/accounting values use USD6 (`1e6` per USD). USDC uses 6 decimals; ETH uses wei. BPS use `10_000`.
- [`AzlPricingPolicy`](../contracts/src/v2/AzlPricingPolicy.sol) converts the selected market's immutable USD6 targets at liability creation using [`AzlUsdOracle.quoteAzlForUsd`](../contracts/src/v2/AzlUsdOracle.sol), rounding up and applying the shared oracle's haircut. A task's poster-created quote is latched and reused by the worker. Do not duplicate economics here; use [`protocol/MARKETS.md`](../protocol/MARKETS.md).
- The entry floor is held while an account has any active reservation; each task reserves the live-task amount. Without a credit, reservation also spends the access fee. Required available balance is the latched entry floor + task reserve + fee.
- Task maximum duration: 30 days. Claim funding window: 1 day. Delivery grace: 1 day. A poster's post-delivery dispute window: 12 hours.
- Manifest parameters: 2-hour TWAP, 15-minute maximum observation gap, 1-hour maximum ETH/USD feed age, 7-day staking reward duration, 3-day evidence window, 2-day ruling window, 10% arbitrator slash cap, and 5% gateway execution-deviation floor. Oracle reference staging delays activation 24 hours, expires after 3 days, and an activated reference expires after 7 days.
- Gateway/executor deadlines are at most 10 minutes. Intake caps are market-specific; read the selected manifest and [`protocol/MARKETS.md`](../protocol/MARKETS.md).

## Task state machine and funds

[`TaskRegistryV2`](../contracts/src/v2/TaskRegistryV2.sol) states are `NONE`, `POSTED`, `CLAIMED`, `ACTIVE`, `DISPUTED`, `COMPLETED`, `CANCELLED`, `RESOLVED`.

- `post(totalAmount, deadline)`: `NONE -> POSTED`; poster reserves collateral, pays an oracle-priced access fee or spends one Action Credit. The task is fixed-total AZL and must fit global and per-poster USD6 exposure caps.
- `claim(taskId)`: `POSTED -> CLAIMED`; a non-poster worker reserves against the poster-latched quote, pays/waives the fee, starts the 1-day funding window, and creates escrow.
- `fund(taskId, amount)`: after approving the selected manifest's `escrowVault`, the poster calls that market's `taskRegistry.fund`. Partial funding remains `CLAIMED`; full funding automatically gives `CLAIMED -> ACTIVE`. `activate()` is a compatibility no-op valid only after activation.
- `markDelivered`: worker records one timely delivery timestamp; it does not move funds or change `ACTIVE`.
- `release`: poster releases any positive amount to worker; full cumulative release gives `ACTIVE -> COMPLETED`. `complete` releases all remaining escrow and completes. Completion increments both parties' `completed` counters and returns spent credits to the pool.
- `cancel`: poster-only, only `POSTED` or unfunded `CLAIMED`, gives `CANCELLED`. After claim, worker compensation can be debited from poster deposits; credit settlement follows the registry rules.
- `expire`: permissionless after task deadline or underfunded claim's funding deadline. It gives `CANCELLED`; remaining escrow always refunds poster. A timely delivery becomes poster default only after the 1-day delivery grace, producing bounded deposit compensation, poster loss reputation, and credit forfeiture—not automatic escrow payment.
- `openDispute`: either party, fully funded `ACTIVE` with unreleased escrow and nonzero evidence hash, gives `DISPUTED`; escrow freezes. A poster disputing timely delivery must do so within 12 hours.
- Arbitration settlement gives `DISPUTED -> RESOLVED`. Terminal states are `COMPLETED`, `CANCELLED`, and `RESOLVED`.

Deposit collateral and job escrow are separate within each market. When that market's intake is active, [`AzlPaymentGateway`](../contracts/src/v2/AzlPaymentGateway.sol) takes exact-input USDC or native ETH, transfers exact AZL output into that market's [`AgentDepositVaultV2`](../contracts/src/v2/AgentDepositVaultV2.sol), and credits only the payer. It does not fund task escrow or another market. Task funding pulls poster-approved AZL through the selected `taskRegistry` into its `escrowVault`. Failed exact payouts are deferred for recipient pull. The public executor is directly callable and explicitly bypasses gateway pause, caps, and deviation guards; it does not credit deposits.

## Action Credits and staking

Each market's [`UnionStakingVaultV2`](../contracts/src/v2/UnionStakingVaultV2.sol) accrues its own credits only while that vault is active and nonzero stake exists. One whole credit is `1e18`; one is spent for a post or claim on the same graph and waives only that action's treasury-bound access fee—not entry collateral, live reserve, default compensation, or exit fees. Rates and caps are market-specific in [`protocol/MARKETS.md`](../protocol/MARKETS.md). Credits are banked, non-cash ledger units; stake, credits, and rewards never cross markets.

## Arbitration, bonds, outcomes, and timeouts

[`ArbitrationModuleV2`](../contracts/src/v2/ArbitrationModuleV2.sol) assigns authorized, eligible, non-party panel members by deterministic round robin. If all capacity is occupied, a dispute can remain unassigned and later be assigned permissionlessly within the fixed resolution horizon.

- Verifiers bond AZL in the selected market's [`VerifierBondVaultV2`](../contracts/src/v2/VerifierBondVaultV2.sol). Minimum bond and assignment reserve are market-specific; read the manifest and [`protocol/MARKETS.md`](../protocol/MARKETS.md). Assignment prevents withdrawal; withdrawal requires the contract-configured cooldown.
- Evidence lasts 3 days, then ruling lasts 2 days. Settlement order is escrow, registry, reputation, then bond release/slash.
- Outcomes: `POSTER_WINS` pays 0% remaining escrow to worker; `WORKER_WINS` pays 100%; `SPLIT` permits worker allocation from 10% through 90%; `MUTUAL` permits 0% or 50%. Winner outcomes charge the proven defaulter's latched $5 exit total ($2.50 harmed party, $2.50 protocol); split/mutual are neutral and charge no exit fee.
- After the absolute evidence-plus-ruling cutoff, anyone may `timeout`: remaining escrow refunds poster, registry records `MUTUAL`, poster receives a light unresolved-dispute loss signal, and an assigned arbitrator may be slashed up to 10% of minimum bond to treasury. Timeout does not apply normal expiry's poster-default deposit bundle.

## Reputation and treasury

[`ReputationRegistryV2`](../contracts/src/v2/ReputationRegistryV2.sol) stores per-address `uint64 completed`, `wins`, and `losses`, with one terminal outcome record per task. Completion increments both parties' `completed`. Poster-default expiry increments poster `losses`. Non-neutral rulings increment winner `wins` and loser `losses`; split/mutual are neutral. Timeout separately increments poster `losses` as an unresolved-dispute signal before neutral terminal recording; it is not an adjudication that the poster was wrong.

[`TreasuryRouterV2`](../contracts/src/v2/TreasuryRouterV2.sol) records received access fees, protocol exit shares, and verifier slashes. Owner-triggered distribution sends 40% to staking rewards, 40% to the configured burn recipient, and retains 20% as reserve (rounding remainder included in reserve). Reserve withdrawal is owner-controlled. “Burn” here means transfer to the manifest `burnRecipient`; the contract does not call an ERC-20 burn function.

## Scope, discovery, and canonical events

[`TaskScopeRegistryV2`](../contracts/src/v2/TaskScopeRegistryV2.sol) lets only the task poster publish one immutable, nonempty scope of at most 8,192 bytes. `ScopePublished` includes task ID, scope hash, and text. Absence of published text is the onchain representation available for private/offchain discovery; the V2 contracts define no private messaging transport.

Index task discovery from registry events: `TaskPosted`, `TaskClaimed`, `TaskFunded`, `TaskActivated`, `TaskDelivered`, `TaskReleased`, `TaskCompleted`, `TaskCancelled`, `TaskDisputed`, `TaskResolved`, `ActionCreditUsed`; join `ScopePublished`. For custody and resolution, also consume escrow `EscrowCreated/Funded/Released/Refunded/Frozen`, arbitration `DisputeOpened/ArbitratorAssigned/EvidenceSubmitted/RulingPhaseStarted/Ruled/ArbitratorSlashed`, and reputation completion/dispute/expiry/unresolved events. Events are history; current state comes from contract storage/views.

## Explicitly absent from V2

The V2 Solidity surface contains no V1 milestone lifecycle, streaming/hour-block payments, proof-submission or review states, direct-hire entrypoint, USDC-denominated task escrow/payment, fixed AZL fee schedule, separate AZL access-fee token charge, pause/delete task states or recovery flow, balance watchdog, subgraph authority, or mutable/re-publishable public scope. Gateway `intakePaused` is only an intake kill switch and is not a task pause. V1 names, addresses, ABIs, and state assumptions are not V2 authority.
