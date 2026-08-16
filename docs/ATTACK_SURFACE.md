# V2 attack surface

Canonical controls live in [V2 Solidity](../contracts/src/v2/). Principal boundaries are oracle freshness/liquidity, fixed-route gateway execution, exact-token transfer semantics, deposit solvency and quote latching, global/per-poster exposure caps, escrow authority, arbitration panel capacity, evidence/ruling liveness, governance bootstrap wiring, and optional-feature activation.

Integrators must read the manifest, verify chain ID and code, check oracle and activation status, set minimum output/deadlines, avoid unlimited allowances where practical, validate event confirmations, and re-read task state before signing. XMTP or HTTP content is untrusted context and cannot substitute for onchain parties, amounts, state, or evidence hashes.

Known economic trade-offs include recoverable capacity griefing under the 20% per-poster cap, staking reward timing, terminal credit-cap timing, and address-level sybils. See [`GRIEFING_RESISTANCE.md`](GRIEFING_RESISTANCE.md).
