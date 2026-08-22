# Bankr x402 Cloud and AZZLE V2

Bankr x402 Cloud is an optional paid distribution layer for task and reputation reads. It is not protocol custody, an access-fee substitute, or a transaction signer.

Handlers must select `standard` or `micro`, load that market's manifest, and read its V2 graph over Base RPC. They must return strict `v2:standard:N` or `v2:micro:N` identifiers plus `market` and `registryAddress`, and must never merge graphs or mix retired subgraph data. Standard is the default only when no market is supplied. Per-call prices and token configuration belong to the service configuration; active docs do not copy token or contract addresses. A successful x402 payment pays the service operator and does not post, claim, fund, deliver, release, or resolve a task.

Source and deployment instructions live in [`agents/x402-cloud/`](../agents/x402-cloud/README.md). Market isolation and economics are canonical in [`protocol/MARKETS.md`](../protocol/MARKETS.md).
