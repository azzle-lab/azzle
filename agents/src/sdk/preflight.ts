import { Contract, ethers } from "ethers";

const VAULT_ABI = ["function deposits(address agent) external view returns (uint256)"];
const ERC20_ABI = [
  "function balanceOf(address account) external view returns (uint256)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function decimals() external view returns (uint8)",
];

export const MIN_VAULT_AZL = 0n; // Dynamic USD-denominated floor is quoted in AZL by AzlPricingPolicy.

export interface PreflightAddresses {
  agentDepositVault: string;
  azlToken: string;
}

export interface PreflightReport {
  wallet: string;
  vaultAzl: bigint;
  azlBalance: bigint;
  vaultOk: boolean;
  warnings: string[];
}

export async function checkWorkerPreflight(
  provider: ethers.Provider,
  wallet: string,
  addresses: PreflightAddresses
): Promise<PreflightReport> {
  const vault = new Contract(addresses.agentDepositVault, VAULT_ABI, provider);
  const azl = new Contract(addresses.azlToken, ERC20_ABI, provider);

  const [vaultAzl, azlBalance] = await Promise.all([
    vault.deposits(wallet) as Promise<bigint>,
    azl.balanceOf(wallet) as Promise<bigint>,
  ]);

  const warnings: string[] = [];
  const vaultOk = vaultAzl > 0n;

  if (!vaultOk) warnings.push("AgentDepositVault has no AZL deposit. Fund through AzlPaymentGateway before fee-bearing actions.");

  return {
    wallet,
    vaultAzl,
    azlBalance,
    vaultOk,
    warnings,
  };
}

export function logPreflightReport(report: PreflightReport): void {
  console.log("[preflight] wallet", report.wallet);
  console.log("[preflight] vault AZL (wei)", report.vaultAzl.toString());
  console.log("[preflight] AZL balance (wei)", report.azlBalance.toString());
  for (const w of report.warnings) {
    console.warn(`[preflight] WARNING: ${w}`);
  }
  if (report.warnings.length === 0) {
    console.log("[preflight] wallet ready for fee-bearing actions");
  }
}
