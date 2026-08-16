# V2 arbitrator bond specification

`VerifierBondVaultV2` holds AZL bonds for arbitration panel members. The deployed minimum bond is read from the manifest; do not copy it into clients.

A member is eligible when bonded at least the minimum, has assignment reserve capacity, and has not scheduled withdrawal. Each assignment reserves one minimum-bond unit. Withdrawals require no active assignments and the configured cooldown. The last eligible panel member cannot withdraw below eligibility unless another eligible member remains.

On arbitration timeout, up to the configured fraction of the minimum bond may be slashed to treasury and the assignment released. Normal rulings release without slash. Failed payouts are deferred.
