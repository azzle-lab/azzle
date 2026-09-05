/** Onchain ArbitrationModuleV2.Outcome */
export const ARBITRATION_OUTCOMES = {
  NONE: 0,
  POSTER_WINS: 1,
  WORKER_WINS: 2,
  SPLIT: 3,
  MUTUAL: 4,
} as const;

export type ArbitrationOutcomeName = keyof typeof ARBITRATION_OUTCOMES;

export const ARBITRATION_STATUS = {
  NONE: 0,
  EVIDENCE: 1,
  RULING: 2,
  SETTLED: 3,
} as const;

export const ARBITRATION_STATUS_NAMES = ["NONE", "EVIDENCE", "RULING", "SETTLED"] as const;

/**
 * Application-layer arbitrator actions. REQUEST_REVISION and ESCALATE_HUMAN are
 * not onchain `rule()` outcomes — send them over XMTP / the dashboard, then
 * either wait for another delivery or map to POSTER_WINS / SPLIT / MUTUAL.
 */
export type ArbitratorIntent =
  | "ACCEPT_WORK"
  | "REJECT_WORK"
  | "REQUEST_REVISION"
  | "SPLIT"
  | "ESCALATE_HUMAN";

export interface ArbitratorDecision {
  schemaVersion: "azzle-arbitration-decision-v1";
  taskId: string;
  intent: ArbitratorIntent;
  /** Set when the intent maps to an onchain rule(). */
  outcome?: ArbitrationOutcomeName;
  workerBps?: number;
  explanation: string;
  evidenceRefs: string[];
  criteriaChecklist?: Array<{ id: string; met: boolean; note?: string }>;
  decidedAt: string;
  arbitrator: string;
  mode: "agent" | "human" | "human-in-the-loop";
}

export interface DisputeRecord {
  taskId: bigint;
  opener: string;
  arbitrator: string;
  posterEvidence: string;
  workerEvidence: string;
  evidenceDeadline: bigint;
  rulingDeadline: bigint;
  status: number;
  statusName: string;
  outcome: number;
  outcomeName: string;
  slashed: bigint;
}

export interface TaskEvidenceBundle {
  taskId: string;
  market: string;
  state: string;
  poster: string;
  worker: string;
  totalAmount: bigint;
  funded: bigint;
  released: bigint;
  deadline: bigint;
  deliveredAt: bigint;
  scope: string;
  parsedScope?: unknown;
  receiptHash?: string;
  artifactUrl?: string;
  dispute: DisputeRecord | null;
  xmtpNote: string;
}

export interface SettlementPreview {
  intent: ArbitratorIntent;
  outcome?: ArbitrationOutcomeName;
  workerBps: number;
  posterReceivesBps: number;
  workerReceivesBps: number;
  note: string;
  onchain: boolean;
}

export const INTENT_TO_OUTCOME: Record<
  ArbitratorIntent,
  { outcome?: ArbitrationOutcomeName; workerBps: number; onchain: boolean; note: string }
> = {
  ACCEPT_WORK: {
    outcome: "WORKER_WINS",
    workerBps: 10_000,
    onchain: true,
    note: "Escrow releases to the worker (100%).",
  },
  REJECT_WORK: {
    outcome: "POSTER_WINS",
    workerBps: 0,
    onchain: true,
    note: "Remaining escrow refunds the poster (0% worker).",
  },
  SPLIT: {
    outcome: "SPLIT",
    workerBps: 5_000,
    onchain: true,
    note: "Default 50/50 split. SPLIT must stay inside 10–90%.",
  },
  REQUEST_REVISION: {
    workerBps: 0,
    onchain: false,
    note: "Offchain only. Ask the worker to revise over XMTP; do not call rule() until the outcome is terminal.",
  },
  ESCALATE_HUMAN: {
    workerBps: 0,
    onchain: false,
    note: "Keep the dispute open and hand the case to a human arbitrator. Do not call rule().",
  },
};

export function previewSettlement(intent: ArbitratorIntent, workerBps?: number): SettlementPreview {
  const mapped = INTENT_TO_OUTCOME[intent];
  const bps = workerBps ?? mapped.workerBps;
  return {
    intent,
    outcome: mapped.outcome,
    workerBps: bps,
    posterReceivesBps: mapped.onchain ? 10_000 - bps : 0,
    workerReceivesBps: mapped.onchain ? bps : 0,
    note: mapped.note,
    onchain: mapped.onchain,
  };
}

export function decisionToRule(decision: ArbitratorDecision): { outcome: number; workerBps: number } {
  if (!decision.outcome || INTENT_TO_OUTCOME[decision.intent].onchain === false) {
    throw new Error(`${decision.intent} is not an onchain rule(). Use XMTP / the dashboard, then rule when the case is terminal.`);
  }
  const outcome = ARBITRATION_OUTCOMES[decision.outcome];
  const workerBps = decision.workerBps ?? INTENT_TO_OUTCOME[decision.intent].workerBps;
  return { outcome, workerBps };
}
