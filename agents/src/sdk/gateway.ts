import { Contract, ethers } from "ethers";
import { withAzzleErrors } from "./errors.js";

/** AzlPaymentGateway.MAX_DEADLINE_WINDOW — deadlines past this revert with "AzlGateway: deadline". */
export const GATEWAY_MAX_DEADLINE_WINDOW_SEC = 10 * 60;
/** Safe default: 5 minutes ahead of the chain clock. */
export const GATEWAY_SAFE_DEADLINE_SEC = 5 * 60;
export const MIN_GATEWAY_AZL_OUT = 1n;

const ORACLE_ABI = ["function quoteAzlForUsd(uint256 usdAmount6) view returns (uint256)", "function isValid() view returns (bool)"];

export interface GatewayDeadlineOptions {
  /** Seconds ahead of the current block timestamp. Must be 1..600. Default 300. */
  windowSeconds?: number;
}

/**
 * Build a gateway deadline from the chain's block timestamp, not the local clock.
 * Local `Date.now()` drifts and caused "AzlGateway: deadline" reverts in the audit pilot.
 */
export async function buildDeadline(
  provider: ethers.Provider,
  options: GatewayDeadlineOptions = {},
): Promise<number> {
  const windowSeconds = Math.floor(options.windowSeconds ?? GATEWAY_SAFE_DEADLINE_SEC);
  if (windowSeconds < 1 || windowSeconds > GATEWAY_MAX_DEADLINE_WINDOW_SEC) {
    throw new Error(
      `Gateway deadline window must be 1–${GATEWAY_MAX_DEADLINE_WINDOW_SEC} seconds (contract MAX_DEADLINE_WINDOW is 10 minutes).`,
    );
  }
  const block = await provider.getBlock("latest");
  const now = Number(block?.timestamp ?? 0);
  if (!now) throw new Error("Could not read Base block timestamp for gateway deadline.");
  return now + windowSeconds;
}

/**
 * Quote a valid minAzlOut. The gateway rejects 0 (`AzlGateway: zero`).
 * `slippageBps` haircuts the oracle quote; the floor is always at least 1 wei.
 */
export async function quoteMinAzlOut(
  provider: ethers.Provider,
  usdOracle: string,
  exactUsdcIn: bigint,
  slippageBps = 100,
): Promise<bigint> {
  if (exactUsdcIn <= 0n) throw new Error("exactUsdcIn must be greater than 0.");
  if (slippageBps < 0 || slippageBps >= 10_000) throw new Error("slippageBps must be 0–9999.");
  const oracle = new Contract(usdOracle, ORACLE_ABI, provider);
  const valid = await oracle.isValid();
  if (!valid) throw new Error("AZL/USD oracle is invalid; cannot quote minAzlOut.");
  const quoted = (await oracle.quoteAzlForUsd(exactUsdcIn)) as bigint;
  const haircut = quoted - (quoted * BigInt(slippageBps)) / 10_000n;
  return haircut > MIN_GATEWAY_AZL_OUT ? haircut : MIN_GATEWAY_AZL_OUT;
}

export function assertValidMinAzlOut(minAzlOut: bigint): bigint {
  if (minAzlOut === 0n) {
    throw new Error(
      "minAzlOut = 0 is invalid (AzlGateway: zero). Use quoteMinAzlOut() or pass 1n as a last-resort floor.",
    );
  }
  return minAzlOut;
}

export async function prepareUsdcDeposit(params: {
  provider: ethers.Provider;
  usdOracle: string;
  exactUsdcIn: bigint;
  slippageBps?: number;
  deadlineWindowSeconds?: number;
}): Promise<{ minAzlOut: bigint; deadline: number }> {
  const minAzlOut = await quoteMinAzlOut(
    params.provider,
    params.usdOracle,
    params.exactUsdcIn,
    params.slippageBps,
  );
  const deadline = await buildDeadline(params.provider, { windowSeconds: params.deadlineWindowSeconds });
  return { minAzlOut, deadline };
}

export { withAzzleErrors };
