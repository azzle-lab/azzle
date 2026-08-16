# Retired x402 example

This directory is retained for package-layout compatibility. AZZLE V2 does not
ship an x402 access-fee flow because task access fees are enforced by deployed
V2 contracts when tasks are posted or claimed.

For current integration behavior, use the Base RPC gateway (`npm run gateway`)
for read-only market discovery and prepare V2 transactions with
`npm run mcp:prepare`.
