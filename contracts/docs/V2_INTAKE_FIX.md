# V2 intake fix and fresh-release procedure

## What changed

`AzlPaymentGateway` now values the exact AZL received from the executor with
`quoteUsdForAzlPar(amount)` in its realized-output guard. The conservative
oracle haircut remains part of USD-to-AZL liability quotes, but is no longer
applied a second time when checking the result of an intake swap.

The configured execution floor remains 500 bps, so the realized output must
still be at least 95% of the input USD value at par.

## Deployment model

The existing V2 graph is preserved. Its gateway, executor, and deposit vault
are one-shot wired and cannot be patched in place. This release therefore uses
a fresh namespace and a fresh coherent graph.

This package uses the selected reset strategy:

- existing balances remain on the old graph;
- existing tasks remain on the old graph;
- no automatic state migration is included;
- the old graph must not be silently replaced in frontend configuration.

The preflight record is
`contracts/deployments/base-8453-v2-intake-fix-deployment-plan.json`.
It contains predicted addresses and the bundle hash, but it is not a deployment
receipt and no transaction has been broadcast.

## Required validation

Install Foundry, set `BASE_RPC_URL`, and run from `contracts/`:

```powershell
forge build
forge test --match-path test/fixtures/FullGraphFixture.t.sol -vv
forge test --fork-url $env:BASE_RPC_URL --fork-block-number <PINNED_BASE_BLOCK> --match-path test/fork/CorrectedIntakeFlow.t.sol -vvv
```

The fork test must verify both funding paths, no gateway token dust, exact
AZL crediting, oracle validity, deadline and minimum-output guards, pause
behavior, and the 5% execution-deviation floor.

The available Hardhat checks are:

```powershell
npm run compile
npm run typecheck
npm test
npm run fork:check
```

`npm test` currently requires invoking Hardhat without the directory argument
on this Windows setup; the focused regression can be run with:

```powershell
npx hardhat test --config hardhat.config.ts --grep "values realized intake output"
```

## Non-broadcast deployment sequence

After the fork test passes, use the fresh namespace:

```powershell
$env:V2_RELEASE_NAMESPACE = "AZZLE_V2_INTAKE_FIX"
$env:V2_ARTIFACT_BASENAME = "base-8453-v2-intake-fix"
```

Then run the existing phased deployment commands only after separately
reviewing the deployer, governance Safe, verifier panel, and gas budget. The
fresh graph also needs its own observation/reference lifecycle before intake:
record observations, propose the reference, wait through the adapter delay,
activate it, and confirm `isReady()` before generating an unpause artifact.

```powershell
$env:V2_PHASE = "preflight"; npx hardhat run scripts/deploy-v2.ts --network base
$env:V2_PHASE = "stage"; npx hardhat run scripts/deploy-v2.ts --network base
# wait until stagedBundleValidAfter, then:
$env:V2_PHASE = "deploy-a"; npx hardhat run scripts/deploy-v2.ts --network base
$env:V2_PHASE = "deploy-b"; npx hardhat run scripts/deploy-v2.ts --network base
$env:V2_PHASE = "bond-check"; npx hardhat run scripts/deploy-v2.ts --network base
$env:V2_PHASE = "deploy-c"; npx hardhat run scripts/deploy-v2.ts --network base
$env:V2_PHASE = "finalize"; npx hardhat run scripts/deploy-v2.ts --network base
$env:V2_PHASE = "verify-deployed"; npx hardhat run scripts/deploy-v2.ts --network base
$env:V2_PHASE = "handoff-artifact"; npx hardhat run scripts/deploy-v2.ts --network base
$env:V2_PHASE = "launch-artifact"; npx hardhat run scripts/deploy-v2.ts --network base
```

Do not run `promote` until the new graph is funded, fork-tested, verified,
accepted by governance, and deliberately selected as the active site/SDK
manifest. Do not use the old launch Safe artifacts for this new namespace.
