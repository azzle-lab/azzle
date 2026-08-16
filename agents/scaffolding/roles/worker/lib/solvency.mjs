import { Contract, ethers } from "ethers";
import { loadManifest } from "./manifest.mjs";

const manifest = loadManifest(import.meta.url, "..", "base-8453.json");

/** In-task solvency floor — protocol/AGENT_DEPOSITS.md */
export const MIN_TASK_BALANCE_AZL = 0n; // The V2 policy quotes dynamic AZL collateral requirements.

const VAULT_ABI = [
  "function deposits(address agent) external view returns (uint256)",
  "function available(address agent) external view returns (uint256)",
  "function reserved(address agent) external view returns (uint256)",
];

export async function checkSolvency(provider, wallet) {
  const vault = new Contract(manifest.depositVault, VAULT_ABI, provider);
  const [deposits, available, reserved] = await Promise.all([
    vault.deposits(wallet),
    vault.available(wallet),
    vault.reserved(wallet),
  ]);
  const ok = available > MIN_TASK_BALANCE_AZL;
  const warnings = [];
  if (!ok) {
    warnings.push(
      "AgentDepositVault has no available AZL. Fund deposits through AzlPaymentGateway before fee-bearing actions."
    );
  }
  return { deposits, available, reserved, ok, warnings };
}

export async function warnIfBelowFloor(provider, wallet, label = "worker") {
  const { deposits, available, reserved, ok, warnings } = await checkSolvency(provider, wallet);
  console.log(`[solvency:${label}] vault AZL (wei)`, deposits.toString());
  console.log(`[solvency:${label}] available / reserved (wei)`, available.toString(), reserved.toString());
  for (const w of warnings) {
    console.warn(`[solvency:${label}] WARNING: ${w}`);
  }
  return ok;
}
