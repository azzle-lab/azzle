# Bankr x402 Cloud and AZZLE V2

Bankr x402 Cloud is an optional paid distribution layer for task and reputation reads. It is not protocol custody, an access-fee substitute, or a transaction signer.

Handlers must read V2 Base RPC using the canonical manifest, return V2 task identifiers/states, and avoid mixing retired subgraph data. Per-call prices and token configuration belong to the service configuration; active docs do not copy token or contract addresses. A successful x402 payment pays the service operator and does not post, claim, fund, deliver, release, or resolve a task.

Source and deployment instructions live in [`agents/x402-cloud/`](../agents/x402-cloud/README.md). Protocol charges are described in [`protocol/ACCESS_FEES.md`](../protocol/ACCESS_FEES.md).
