import type { AzzleV2Client } from "../client-v2.js";
import { parseCompletionCriteria, evaluateCriteria, type CompletionCriteria } from "../criteria.js";
import type { TaskRef } from "../markets.js";
import { withAzzleErrors } from "../errors.js";
import { gatherTaskEvidence } from "./evidence.js";
import {
  decisionToRule,
  previewSettlement,
  type ArbitratorDecision,
  type ArbitratorIntent,
  type TaskEvidenceBundle,
} from "./types.js";

export type ArbitratorMode = "agent" | "human" | "human-in-the-loop";

export interface ArbitratorHooks {
  /** Autonomous or assisting agent. Human-in-the-loop may ignore the recommendation. */
  recommend?: (bundle: TaskEvidenceBundle, criteria: CompletionCriteria | null) => Promise<ArbitratorDecision> | ArbitratorDecision;
}

export class AzzleArbitrator {
  constructor(
    private readonly client: AzzleV2Client,
    private readonly arbitrator: string,
    private readonly mode: ArbitratorMode = "human-in-the-loop",
    private readonly hooks: ArbitratorHooks = {},
  ) {}

  async loadCase(taskId: TaskRef | string, extras?: { receiptHash?: string; artifactUrl?: string }): Promise<TaskEvidenceBundle> {
    return gatherTaskEvidence(this.client, taskId, extras);
  }

  suggest(bundle: TaskEvidenceBundle): ArbitratorDecision | Promise<ArbitratorDecision> {
    const criteria = parseCompletionCriteria(bundle.parsedScope && typeof bundle.parsedScope === "object"
      ? (bundle.parsedScope as { completionCriteria?: unknown }).completionCriteria
      : null);
    if (this.hooks.recommend) return this.hooks.recommend(bundle, criteria);
    return {
      schemaVersion: "azzle-arbitration-decision-v1",
      taskId: bundle.taskId,
      intent: "ESCALATE_HUMAN",
      explanation: "No recommender configured. Review scope vs delivery in the dashboard, then choose Accept, Reject, Split, or Request revision.",
      evidenceRefs: [bundle.scope, bundle.receiptHash ?? "", bundle.artifactUrl ?? ""].filter(Boolean),
      decidedAt: new Date().toISOString(),
      arbitrator: this.arbitrator,
      mode: this.mode,
    };
  }

  preview(intent: ArbitratorIntent, workerBps?: number) {
    return previewSettlement(intent, workerBps);
  }

  async submitEvidence(taskId: TaskRef | string, evidenceHash: string) {
    return withAzzleErrors(() => this.client.submitEvidence(taskId, evidenceHash));
  }

  async beginRuling(taskId: TaskRef | string) {
    return withAzzleErrors(() => this.client.beginRuling(taskId));
  }

  async rule(decision: ArbitratorDecision) {
    const { outcome, workerBps } = decisionToRule(decision);
    return withAzzleErrors(() => this.client.rule(decision.taskId, outcome, workerBps));
  }

  async timeout(taskId: TaskRef | string) {
    return withAzzleErrors(() => this.client.timeout(taskId));
  }

  async assign(taskId: TaskRef | string) {
    return withAzzleErrors(() => this.client.assignArbitrator(taskId));
  }

  evaluateCriteria(bundle: TaskEvidenceBundle, evidence: Record<string, { met: boolean; note?: string }>) {
    const criteria = parseCompletionCriteria(
      bundle.parsedScope && typeof bundle.parsedScope === "object"
        ? (bundle.parsedScope as { completionCriteria?: unknown }).completionCriteria
        : null,
    );
    if (!criteria) return null;
    return evaluateCriteria(criteria, evidence);
  }
}
