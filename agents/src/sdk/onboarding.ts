import { ethers } from "ethers";
import { MARKET_ECONOMICS, type AzzleMarket } from "./markets.js";

/** Micro does not sponsor worker transactions. Workers need ETH on Base for claim/deliver. */
export const WORKER_GAS_SPONSORED = false;
export const MIN_WORKER_ETH_WEI = 10n ** 15n; // 0.001 ETH — enough for a few Base txs

export interface GasReadiness {
  sponsored: boolean;
  ethWei: bigint;
  ok: boolean;
  message: string;
}

export async function checkWorkerGas(provider: ethers.Provider, wallet: string): Promise<GasReadiness> {
  const ethWei = await provider.getBalance(wallet);
  if (WORKER_GAS_SPONSORED) {
    return { sponsored: true, ethWei, ok: true, message: "Protocol sponsorship is active for worker transactions." };
  }
  const ok = ethWei >= MIN_WORKER_ETH_WEI;
  return {
    sponsored: false,
    ethWei,
    ok,
    message: ok
      ? `Wallet has ${ethers.formatEther(ethWei)} ETH on Base for gas. Azzle does not currently sponsor worker claim/deliver transactions.`
      : "You need ETH on Base for claim/deliver transactions unless you provide your own sponsorship. Micro does not sponsor worker transactions yet.",
  };
}

export interface BootstrapCheck {
  market: AzzleMarket;
  gas: GasReadiness;
  depositOk: boolean;
  warnings: string[];
}

export async function checkPilotBootstrap(params: {
  provider: ethers.Provider;
  wallet: string;
  market: AzzleMarket;
  depositWei: bigint;
}): Promise<BootstrapCheck> {
  const gas = await checkWorkerGas(params.provider, params.wallet);
  const floorUsd6 = MARKET_ECONOMICS[params.market].postingFloorUsd6;
  const warnings: string[] = [];
  if (!gas.ok) warnings.push(gas.message);
  const depositOk = params.depositWei > 0n;
  if (!depositOk) {
    warnings.push(
      `Fund the ${params.market} deposit vault (about $${(floorUsd6 / 1_000_000).toFixed(2)} floor) through fundWithUsdc / the Azzle wallet. There is no hosted faucet yet — ask Azzle for a pilot USDC transfer if you are integrating.`,
    );
  }
  warnings.push("Azzle does not yet ship a one-click faucet. Pilot setup still needs ETH for gas, Micro/Standard collateral, and AZL (or USDC to swap) for the task budget.");
  return { market: params.market, gas, depositOk, warnings };
}
