# Bankr AZZLE skill source

This directory is the canonical source package for the public
[`BankrBot/skills/azzle`](https://github.com/BankrBot/skills/tree/main/azzle)
integration.

Copy the contents of [`azzle/`](azzle/) to the external repository's `azzle/`
directory when publishing. Do not edit a separate release copy.

## Validate

From the AZZLE repository root:

```bash
npm run check:bankr-skill
```

Validation enforces:

- standard and micro reviewed pins match their canonical deployment manifests
- shared oracle fields remain equal and market graph fields remain isolated
- task references are strictly `v2:standard:N` or `v2:micro:N`
- manifest version and Base chain ID are documented
- required V2 lifecycle, API, and collateral terms are present
- retired subgraph, USDC-escrow, fixed-fee, state, and selector language is absent
- `catalog.json` is valid JSON
- the read-only helper passes shell syntax checks when Bash is available

The public Bankr skill remains stale until these files are submitted to and
merged in `BankrBot/skills`.
