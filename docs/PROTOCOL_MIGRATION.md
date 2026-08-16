# V1 to V2 protocol migration

V2 is the only active protocol surface. New integrations must use [`contracts/src/v2/`](../contracts/src/v2/), lower-camel keys from [`base-8453.json`](../contracts/deployments/base-8453.json), AZL-denominated custody, the eight-state V2 lifecycle, and Base RPC discovery.

Do not translate V1 state in place. Keep historical records namespaced by deployment and migrate clients to V2 ABIs/events. Remove USDC job escrow, fixed AZL fee, direct-hire, escrow modes, proof review, pause/delete recovery, party-selected/tiered arbitration, weighted reputation signals, and V1 subgraph assumptions.

Gateway intake and staking availability are live-state checks, not migration guarantees. Historical V1 explanation belongs only under [`legacy-v1/`](legacy-v1/).
