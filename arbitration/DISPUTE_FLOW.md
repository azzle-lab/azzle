# V2 dispute flow

Normative implementation: [`ArbitrationModuleV2.sol`](../contracts/src/v2/ArbitrationModuleV2.sol).

1. A poster or worker calls `TaskRegistryV2.openDispute` on active, fully funded work with unreleased value and a nonzero evidence hash. The registry changes state to DISPUTED.
2. Arbitration selects the next eligible bonded panel member round-robin when capacity exists, records the opener's evidence, and freezes escrow. Parties do not nominate the arbitrator.
3. Either party may `submitEvidence` before `evidenceDeadline`. Anyone may call `beginRuling` after it.
4. The assigned arbitrator calls `rule` before `rulingDeadline` with poster win (0% worker), worker win (100%), split (10?90%), or mutual (0% or 50%).
5. Settlement order is escrow split, registry deposit/credit resolution, reputation record, then bond release.

If no panel capacity existed, `assignArbitrator` is permissionless within the bounded assignment window. After the absolute evidence-plus-ruling cutoff, anyone may call `timeout`: remaining escrow refunds the poster, the task resolves MUTUAL, the poster receives an unresolved-dispute signal, and an assigned arbitrator may be slashed up to the configured cap.

Poster disputes after timely delivery must open within the contract's half-grace cutoff. Read window and bond parameters from the manifest.
