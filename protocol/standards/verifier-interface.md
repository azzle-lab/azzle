# V2 bonded arbitrator interface reference

V2 does not implement verifier registration, attestation quorums, domains, confidence scores, or auto-release. The active bond surface is [`VerifierBondVaultV2.sol`](../../contracts/src/v2/VerifierBondVaultV2.sol): `bond`, `scheduleWithdrawal`, `withdraw`, eligibility views, and arbitration-only assignment/release/slash methods.

Verification may exist as offchain application policy. It must not be represented as V2 contract enforcement. See [the bond specification](../../arbitration/VERIFIER_SPEC.md).
