/**
 * Optional post-settlement AZL → USDC preference. Azzle does not take a protocol
 * cut of task budget; converting earned AZL through Uniswap is the worker's
 * off-ramp (the swap fee is the only spread).
 */
export interface SettlementPreference {
  /** `hold` keeps AZL; `usdc` signals the worker wants an off-ramp after release. */
  prefer: "hold" | "usdc" | "stake";
  minAzlWei?: bigint;
}

export function describeSettlementPreference(pref: SettlementPreference): string {
  if (pref.prefer === "usdc") {
    return "After the poster releases, swap earned AZL to USDC on Uniswap (Base). Azzle has no built-in off-ramp; the swap fee is the spread.";
  }
  if (pref.prefer === "stake") {
    return "After release, stake AZL in the Union vault for Action Credits that can waive your access fee on later tasks.";
  }
  return "Hold AZL in the worker wallet after release.";
}
