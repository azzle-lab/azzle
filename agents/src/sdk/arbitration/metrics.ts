export interface ArbitratorMetrics {
  cases: number;
  resolved: number;
  avgResolutionSec: number;
  intents: Record<string, number>;
}

export function emptyArbitratorMetrics(): ArbitratorMetrics {
  return { cases: 0, resolved: 0, avgResolutionSec: 0, intents: {} };
}

export function recordDecision(
  current: ArbitratorMetrics,
  input: { intent: string; resolutionSec: number; terminal: boolean },
): ArbitratorMetrics {
  const cases = current.cases + 1;
  const resolved = current.resolved + (input.terminal ? 1 : 0);
  const total = current.avgResolutionSec * current.cases + input.resolutionSec;
  const intents = { ...current.intents, [input.intent]: (current.intents[input.intent] ?? 0) + 1 };
  return { cases, resolved, avgResolutionSec: cases ? total / cases : 0, intents };
}
