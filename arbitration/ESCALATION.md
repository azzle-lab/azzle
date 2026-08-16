# V2 arbitration liveness

V2 has no tier escalation. A dispute receives deterministic round-robin assignment from a curated bonded panel. If all members lack capacity at open, anyone may call `assignArbitrator` while enough bounded ruling time remains. If no ruling arrives by the absolute cutoff, anyone may call `timeout`.

See [`DISPUTE_FLOW.md`](DISPUTE_FLOW.md). V1 tier rules are historical only.
