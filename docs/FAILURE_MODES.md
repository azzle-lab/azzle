# V2 failure modes

- Gateway paused: no gateway intake; task contracts remain usable by funded accounts.
- Oracle invalid/stale or insufficient observations: new quotes, exposure admission, or gateway funding revert; existing custody remains.
- Funding window missed: permissionless `expire` refunds escrow and may compensate the worker from poster deposits.
- Timely delivery without poster action: after one-day grace, `expire` refunds escrow to poster but applies bounded poster deposit/reputation/credit consequences. It does not trust self-asserted delivery enough to auto-pay escrow.
- Dispute panel full: permissionless delayed assignment while the bounded window remains.
- Arbitrator misses ruling: permissionless timeout, poster refund, unresolved signal, possible bond slash.
- Exact transfer failure: operation reverts or payout is deferred for pull claim, depending on path.
- RPC/indexer lag: re-read the manifest contract over another Base RPC before acting.

There is no V2 pause/delete recovery state or tier escalation.
