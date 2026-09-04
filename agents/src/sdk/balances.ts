import { MARKET_ECONOMICS, type AzzleMarket } from "./markets.js";

export interface CustomerBalances {
  /** USD-equivalent deposit vault (Micro/Standard operating collateral). */
  operatingUsd: number;
  /** USD-equivalent AZL in the wallet available to fund task escrow. */
  workBudgetUsd: number;
  market: AzzleMarket;
  requiredFloorUsd: number;
  taskBudgetUsd?: number;
}

export interface PosterPreflight {
  canSubmit: boolean;
  operatingOk: boolean;
  workBudgetOk: boolean;
  labels: {
    operating: string;
    work: string;
  };
  blockers: string[];
}

/**
 * Customer-facing copy. Protocol still uses AZL wei and isolated vaults;
 * posters should see "operating balance" vs "available for work".
 */
export function describeCustomerBalances(balances: CustomerBalances): PosterPreflight {
  const floor = balances.requiredFloorUsd || MARKET_ECONOMICS[balances.market].postingFloorUsd6 / 1_000_000;
  const task = balances.taskBudgetUsd ?? 0;
  const operatingOk = balances.operatingUsd + 1e-9 >= floor;
  const workBudgetOk = task <= 0 || balances.workBudgetUsd + 1e-9 >= task;
  const blockers: string[] = [];
  if (!operatingOk) {
    blockers.push(
      `Azzle operating balance is $${balances.operatingUsd.toFixed(2)}; deposit at least $${floor.toFixed(2)} ${balances.market} collateral before posting.`,
    );
  }
  if (!workBudgetOk) {
    blockers.push(
      `Available for work is $${balances.workBudgetUsd.toFixed(2)}; this task needs about $${task.toFixed(2)} in AZL (USDC can be swapped at fund time).`,
    );
  }
  return {
    canSubmit: operatingOk && workBudgetOk,
    operatingOk,
    workBudgetOk,
    labels: {
      operating: `Azzle operating balance: $${balances.operatingUsd.toFixed(2)}`,
      work: `Available for work: $${balances.workBudgetUsd.toFixed(2)}`,
    },
    blockers,
  };
}

export function recommendedMicroOnrampUsd(taskBudgetUsd: number): { operatingUsd: number; workUsd: number; totalUsd: number } {
  const operatingUsd = Math.max(10, MARKET_ECONOMICS.micro.postingFloorUsd6 / 1_000_000 + 5);
  return { operatingUsd, workUsd: taskBudgetUsd, totalUsd: operatingUsd + taskBudgetUsd };
}
