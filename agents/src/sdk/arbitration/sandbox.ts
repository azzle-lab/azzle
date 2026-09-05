import type { ArbitratorDecision, ArbitratorIntent, TaskEvidenceBundle } from "./types.js";

export interface SandboxCase {
  id: string;
  title: string;
  bundle: TaskEvidenceBundle;
  expectedIntent: ArbitratorIntent;
  notes: string;
}

const NOW = 1_704_000_000;

function bundle(partial: Partial<TaskEvidenceBundle> & Pick<TaskEvidenceBundle, "taskId" | "scope">): TaskEvidenceBundle {
  return {
    market: "micro",
    state: "DISPUTED",
    poster: "0x1111111111111111111111111111111111111111",
    worker: "0x2222222222222222222222222222222222222222",
    totalAmount: 10n ** 18n,
    funded: 10n ** 18n,
    released: 0n,
    deadline: BigInt(NOW + 86400),
    deliveredAt: BigInt(NOW),
    parsedScope: undefined,
    receiptHash: "0xabc",
    artifactUrl: "https://example.invalid/report.json",
    dispute: {
      taskId: 5n,
      opener: "0x1111111111111111111111111111111111111111",
      arbitrator: "0x3333333333333333333333333333333333333333",
      posterEvidence: "0x01",
      workerEvidence: "0x02",
      evidenceDeadline: BigInt(NOW + 3600),
      rulingDeadline: BigInt(NOW + 7200),
      status: 2,
      statusName: "RULING",
      outcome: 0,
      outcomeName: "NONE",
      slashed: 0n,
    },
    xmtpNote: "Sandbox case — no live XMTP.",
    ...partial,
  };
}

export const SANDBOX_CASES: SandboxCase[] = [
  {
    id: "audit-complete",
    title: "Audit report covers the posted VulnerableBank scope",
    expectedIntent: "ACCEPT_WORK",
    notes: "Scope named three issues; delivery reports reentrancy, open setOwner, and tx.origin.",
    bundle: bundle({
      taskId: "v2:micro:5",
      scope: JSON.stringify({
        taskType: "solidity-audit",
        source: "contract VulnerableBank { function withdraw() public { /* reentrancy */ } }",
        completionCriteria: {
          schemaVersion: "azzle-criteria-v1",
          mode: "checklist",
          items: [
            { id: "findings", description: "Report named issues in the posted source", required: true },
            { id: "hash", description: "receiptHash matches report bytes", required: true },
          ],
        },
      }),
    }),
  },
  {
    id: "empty-delivery",
    title: "Worker delivered a hash with no inspectable artifact",
    expectedIntent: "REQUEST_REVISION",
    notes: "Ask for a hosted or inline report before ruling.",
    bundle: bundle({
      taskId: "v2:micro:6",
      artifactUrl: undefined,
      receiptHash: undefined,
      scope: JSON.stringify({ taskType: "solidity-audit", address: "0x0000000000000000000000000000000000000001" }),
    }),
  },
  {
    id: "wrong-contract",
    title: "Delivery audits a different address than the scope",
    expectedIntent: "REJECT_WORK",
    notes: "Scope mismatch is a poster win unless the worker revises in time.",
    bundle: bundle({
      taskId: "v2:micro:7",
      scope: JSON.stringify({ taskType: "solidity-audit", address: "0x0000000000000000000000000000000000000001" }),
      artifactUrl: "https://example.invalid/wrong.json",
    }),
  },
];

export function gradeSandboxDecision(caseId: string, decision: Pick<ArbitratorDecision, "intent">): {
  passed: boolean;
  expected: ArbitratorIntent;
  actual: ArbitratorIntent;
} {
  const fixture = SANDBOX_CASES.find((row) => row.id === caseId);
  if (!fixture) throw new Error(`Unknown sandbox case '${caseId}'`);
  return {
    passed: fixture.expectedIntent === decision.intent,
    expected: fixture.expectedIntent,
    actual: decision.intent,
  };
}
