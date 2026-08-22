import { artifacts } from "hardhat";

const EIP170_LIMIT = 24_576;
const CONTRACTS = [
  "EscrowVault",
  "TaskRegistry",
  "ReputationRegistry",
  "ArbitrationModule",
  "ArbitrationSatellite",
  "ArbitrationRecoveryCoordinator",
  "TreasuryRouter",
  "AgentDepositVault",
  "UnionStakingVault",
  "TaskScopeRegistry",
  "AzlV4ObservationOracle",
  "AzlEthTwapAdapter",
  "AzlUsdOracle",
  "AzlPricingPolicy",
  "AgentDepositVaultV2",
  "EscrowVaultV2",
  "ReputationRegistryV2",
  "VerifierBondVaultV2",
  "UnionStakingVaultV2",
  "TreasuryRouterV2",
  "TaskRegistryV2",
  "ArbitrationModuleV2",
  "BaseUsdcWethExactInputLeg",
  "BaseAzlExactInputExecutor",
  "AzlPaymentGateway",
  "AzzleSuiteV2Factory",
  "AzzleSuiteV2MicroFactory",
  "TaskScopeRegistryV2",
] as const;

async function main() {
  let failed = false;
    for (const contract of CONTRACTS) {
    let artifact;
    try {
      artifact = await artifacts.readArtifact(contract);
    } catch {
      console.log(`${contract}: skipped (artifact missing)`);
      continue;
    }
    const size = (artifact.deployedBytecode.length - 2) / 2;
    const remaining = EIP170_LIMIT - size;
    console.log(
      `${contract}: ${size} bytes (${remaining >= 0 ? `${remaining} spare` : `${-remaining} over`})`
    );
    if (remaining < 0) failed = true;
  }
  if (failed) throw new Error("One or more suite contracts exceed EIP-170");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
