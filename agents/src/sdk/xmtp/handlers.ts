import type { AzzleV2Client } from "../client-v2.js";
import { buildSettlementDigest } from "../settlement.js";
import type { TaskTerms } from "../types.js";
import type { AzzleEnvelope } from "./types.js";
import { MESSAGE_TYPES } from "./types.js";
import type { XmtpNegotiationTransport } from "./transport.js";
import { assertCounterpartySignature } from "./settlement-verify.js";
import { buildSettlementTypedData } from "./settlement-verify.js";
import { validatePayload } from "./validation.js";

export type AgentRole = "poster" | "worker";

/* Typed payloads for inbound messages (mirror agents/schemas/xmtp). */

export interface RevisionRequestPayload {
  type: "azzle/RevisionRequest";
  taskId: string;
  requestedChanges: string;
  specHash?: string;
  deadlineExtension?: number;
}

export interface DeliveryNoticePayload {
  type: "azzle/DeliveryNotice";
  taskId: string;
  receiptHash: string;
  receiptUri?: string;
  artifactUris?: string[];
}

export interface AcceptDeliveryPayload {
  type: "azzle/AcceptDelivery";
  taskId: string;
  receiptHash?: string;
  acceptedAt?: string;
}

export interface PaymentRequestPayload {
  type: "azzle/PaymentRequest";
  taskId: string;
  releaseType: "full" | "partial";
  amount?: string;
  periodStart?: string;
  periodEnd?: string;
}

export interface CapabilityProofPayload {
  type: "azzle/CapabilityProof";
  capabilityId: string;
  evidence: Record<string, unknown>;
  signature?: string;
}

export interface DisputeEvidencePayload {
  type: "azzle/DisputeEvidence";
  taskId: string;
  disputeId: string;
  claim: "non_delivery" | "quality" | "scope" | "payment" | "other";
  evidenceHashes: string[];
  receiptHash?: string;
  counterReceiptHash?: string;
}

export interface SupervisorVetoPayload {
  type: "azzle/SupervisorVeto";
  taskId: string;
  supervisor: string;
  reason: string;
  vetoedAt?: string;
}

/** On-chain verification result attached to an inbound DeliveryNotice. */
export interface DeliveryDecision {
  envelope: AzzleEnvelope;
  payload: DeliveryNoticePayload;
  /** V2 delivery verification is represented by the task state and settlement digest. */
  onChainDelivered: boolean;
  /** V2 does not store the off-chain receipt hash on-chain. */
  onChainReceiptHash: string;
  /** true when the V2 task is in the delivery/settlement state expected by the envelope */
  verified: boolean;
  /** Release the V2 task on-chain and send AcceptDelivery over XMTP. */
  accept: () => Promise<void>;
}

/** On-chain verification result attached to an inbound PaymentRequest (poster side). */
export interface PaymentDecision {
  envelope: AzzleEnvelope;
  payload: PaymentRequestPayload;
  /** Whether the worker has marked the V2 task delivered on-chain. */
  onChainDelivered: boolean;
  verified: boolean;
  /** Release the requested amount, or complete the task for a full request. */
  approve: () => Promise<void>;
}

export interface TaskAcceptedInfo {
  envelope: AzzleEnvelope;
  settlementDigest: string;
  taskId: string;
  /** V2 requires the negotiation to be bound to an already-posted task. */
  createdOnChain: false;
}

/**
 * Optional consumer hooks — all invoked after schema validation and any
 * on-chain verification. Register via NegotiationHandlersConfig.callbacks.
 */
export interface NegotiationCallbacks {
  onTaskAccepted?: (info: TaskAcceptedInfo) => void | Promise<void>;
  onRevisionRequested?: (
    payload: RevisionRequestPayload,
    envelope: AzzleEnvelope
  ) => void | Promise<void>;
  /** Poster side: worker delivered — decide whether to accept (decision.accept()). */
  onDeliveryNotice?: (decision: DeliveryDecision) => void | Promise<void>;
  /** Worker side: poster accepted delivery and completed settlement. */
  onPaymentNotice?: (
    payload: AcceptDeliveryPayload,
    envelope: AzzleEnvelope
  ) => void | Promise<void>;
  /** Poster side: worker requests a release — decide whether to approve (decision.approve()). */
  onPaymentRequest?: (decision: PaymentDecision) => void | Promise<void>;
  onCapabilityProof?: (
    payload: CapabilityProofPayload,
    envelope: AzzleEnvelope
  ) => void | Promise<void>;
  onDisputeEvidence?: (
    payload: DisputeEvidencePayload,
    envelope: AzzleEnvelope
  ) => void | Promise<void>;
  onSupervisorVeto?: (
    payload: SupervisorVetoPayload,
    envelope: AzzleEnvelope
  ) => void | Promise<void>;
}

/** Accumulated off-chain negotiation state (one instance per NegotiationHandlers). */
export interface NegotiationState {
  taskId?: string;
  accepted?: TaskAcceptedInfo;
  revisionRequests: RevisionRequestPayload[];
  deliveries: DeliveryNoticePayload[];
  acceptedDeliveries: AcceptDeliveryPayload[];
  paymentRequests: PaymentRequestPayload[];
  disputeEvidence: DisputeEvidencePayload[];
  capabilityProofs: CapabilityProofPayload[];
  veto?: SupervisorVetoPayload;
}

export interface NegotiationHandlersConfig {
  transport: XmtpNegotiationTransport;
  azzle: AzzleV2Client;
  evmSigner: import("ethers").Signer;
  role: AgentRole;
  terms: TaskTerms;
  chainId: bigint;
  counterpartyEvm: string;
  /** Optional consumer hooks for inbound messages. */
  callbacks?: NegotiationCallbacks;
  /**
   * Opt-in: automatically settle escrow when an inbound DeliveryNotice /
   * PaymentRequest is verified against the V2 delivered state.
   * Default false — settlements always require an explicit decision.
   */
  autoAccept?: boolean;
}

const ZERO_HASH = "0x" + "00".repeat(32);

function emptyNegotiationState(): NegotiationState {
  return {
    revisionRequests: [],
    deliveries: [],
    acceptedDeliveries: [],
    paymentRequests: [],
    disputeEvidence: [],
    capabilityProofs: [],
  };
}

export class NegotiationHandlers {
  private readonly stateByNegotiation = new Map<string, NegotiationState>();

  constructor(private readonly config: NegotiationHandlersConfig) {}

  private get transport() {
    return this.config.transport;
  }

  private get terms() {
    return this.config.terms;
  }

  private get callbacks(): NegotiationCallbacks {
    return this.config.callbacks ?? {};
  }

  private get autoAccept(): boolean {
    return this.config.autoAccept === true;
  }

  /** Accumulated negotiation state for consumers (read-only snapshot semantics). */
  negotiationState(negotiationId: string): NegotiationState {
    let state = this.stateByNegotiation.get(negotiationId);
    if (!state) {
      state = emptyNegotiationState();
      this.stateByNegotiation.set(negotiationId, state);
    }
    return state;
  }

  /** Resolve the on-chain taskId for an envelope (envelope field or transport binding). */
  private resolveTaskId(envelope: AzzleEnvelope): string | undefined {
    return (
      envelope.taskId ??
      this.transport.negotiationToTaskId.get(envelope.negotiationId) ??
      this.negotiationState(envelope.negotiationId).taskId ??
      (typeof (envelope.payload as { taskId?: unknown }).taskId === "string"
        ? ((envelope.payload as { taskId: string }).taskId)
        : undefined)
    );
  }

  private requireBoundSettlementTask(
    envelope: AzzleEnvelope,
    payloadTaskId: string
  ): string {
    const boundTaskId =
      this.transport.negotiationToTaskId.get(envelope.negotiationId);
    if (!boundTaskId) {
      throw new Error("Settlement message requires a bound negotiation task");
    }
    if (
      boundTaskId !== payloadTaskId ||
      (envelope.taskId !== undefined && envelope.taskId !== boundTaskId)
    ) {
      throw new Error("Settlement task does not match negotiation binding");
    }
    return boundTaskId;
  }

  private async requireSettlementParties(taskId: string): Promise<void> {
    const task = await this.config.azzle.getTask(BigInt(taskId));
    const signer = (await this.config.evmSigner.getAddress()).toLowerCase();
    if (
      task.poster.toLowerCase() !== signer ||
      task.worker.toLowerCase() !== this.config.counterpartyEvm.toLowerCase()
    ) {
      throw new Error("Settlement parties do not match negotiation participants");
    }
  }

  async handle(envelope: AzzleEnvelope): Promise<void> {
    if ((MESSAGE_TYPES as readonly string[]).includes(envelope.type)) {
      validatePayload(envelope.type, envelope.payload);
    }
    switch (envelope.type) {
      case "TaskProposal":
        return this.onTaskProposal(envelope);
      case "TaskCounterOffer":
        return this.onTaskCounterOffer(envelope);
      case "TaskAcceptance":
        return this.onTaskAcceptance(envelope);
      case "RevisionRequest":
        return this.onRevisionRequest(envelope);
      case "DeliveryNotice":
        return this.onDeliveryNotice(envelope);
      case "PaymentRequest":
        return this.onPaymentRequest(envelope);
      case "CapabilityProof":
        return this.onCapabilityProof(envelope);
      case "DisputeEvidence":
        return this.onDisputeEvidence(envelope);
      case "SupervisorVeto":
        return this.onSupervisorVeto(envelope);
      case "AcceptDelivery":
        return this.onAcceptDelivery(envelope);
      default:
        console.warn(`[negotiation] unhandled type ${envelope.type}`);
    }
  }

  async sendTaskProposal(negotiationId: string, task: Record<string, unknown>): Promise<void> {
    const digest = buildSettlementDigest(this.terms);
    await this.transport.send({
      type: "TaskProposal",
      negotiationId,
      payload: {
        type: "azzle/TaskProposal",
        task,
        settlementDigestPreview: digest,
      },
    });
  }

  async sendTaskCounterOffer(
    negotiationId: string,
    task: Record<string, unknown>,
    rationale?: string
  ): Promise<void> {
    const digest = buildSettlementDigest(this.terms);
    await this.transport.send({
      type: "TaskCounterOffer",
      negotiationId,
      payload: {
        type: "azzle/TaskCounterOffer",
        task,
        settlementDigestPreview: digest,
        rationale,
      },
    });
  }

  async signTaskAcceptance(): Promise<{ digest: string; signature: string }> {
    const digest = buildSettlementDigest(this.terms);
    const typed = buildSettlementTypedData({
      settlementDigest: digest,
      poster: this.terms.poster,
      worker: this.terms.worker,
      chainId: this.config.chainId,
    });
    const signature = await this.config.evmSigner.signTypedData(
      typed.domain,
      typed.types,
      typed.message
    );
    return { digest, signature };
  }

  async sendTaskAcceptance(
    negotiationId: string,
    posterSignature: string,
    workerSignature: string,
    task?: Record<string, unknown>
  ): Promise<void> {
    const digest = buildSettlementDigest(this.terms);
    await this.transport.send({
      type: "TaskAcceptance",
      negotiationId,
      payload: {
        type: "azzle/TaskAcceptance",
        settlementDigest: digest,
        posterSignature,
        workerSignature,
        task,
        acceptedAt: new Date().toISOString(),
      },
    });
  }

  async sendDeliveryNotice(
    negotiationId: string,
    params: {
      taskId: string;
      receiptHash: string;
      receiptUri?: string;
      artifactUris?: string[];
    }
  ): Promise<void> {
    if (this.config.role !== "worker") {
      throw new Error("Only the worker may send DeliveryNotice");
    }
    await this.config.azzle.markDelivered(BigInt(params.taskId));
    await this.transport.send({
      type: "DeliveryNotice",
      negotiationId,
      taskId: params.taskId,
      payload: {
        type: "azzle/DeliveryNotice",
        ...params,
      },
    });
  }

  async sendRevisionRequest(
    negotiationId: string,
    taskId: string,
    requestedChanges: string
  ): Promise<void> {
    await this.transport.send({
      type: "RevisionRequest",
      negotiationId,
      taskId,
      payload: { type: "azzle/RevisionRequest", taskId, requestedChanges },
    });
  }

  async sendPaymentRequest(
    negotiationId: string,
    payload: {
      taskId: string;
      releaseType: "full" | "partial";
      amount?: string;
    }
  ): Promise<void> {
    await this.transport.send({
      type: "PaymentRequest",
      negotiationId,
      taskId: payload.taskId,
      payload: { type: "azzle/PaymentRequest", ...payload },
    });
  }

  async sendCapabilityProof(
    negotiationId: string,
    capabilityId: string,
    evidence: Record<string, unknown>
  ): Promise<void> {
    await this.transport.send({
      type: "CapabilityProof",
      negotiationId,
      payload: { type: "azzle/CapabilityProof", capabilityId, evidence },
    });
  }

  async sendDisputeEvidence(
    negotiationId: string,
    payload: {
      taskId: string;
      disputeId: string;
      claim: "non_delivery" | "quality" | "scope" | "payment" | "other";
      evidenceHashes: string[];
    }
  ): Promise<void> {
    await this.transport.send({
      type: "DisputeEvidence",
      negotiationId,
      taskId: payload.taskId,
      payload: { type: "azzle/DisputeEvidence", ...payload },
    });
  }

  async sendSupervisorVeto(
    negotiationId: string,
    payload: { taskId: string; supervisor: string; reason: string }
  ): Promise<void> {
    await this.transport.send({
      type: "SupervisorVeto",
      negotiationId,
      taskId: payload.taskId,
      payload: { type: "azzle/SupervisorVeto", ...payload, vetoedAt: new Date().toISOString() },
    });
  }

  async sendAcceptDelivery(
    negotiationId: string,
    params: { taskId: string; receiptHash?: string }
  ): Promise<void> {
    if (this.config.role !== "poster") {
      throw new Error("Only the poster may send AcceptDelivery");
    }
    await this.config.azzle.complete(BigInt(params.taskId));
    await this.transport.send({
      type: "AcceptDelivery",
      negotiationId,
      taskId: params.taskId,
      payload: {
        type: "azzle/AcceptDelivery",
        taskId: params.taskId,
        receiptHash: params.receiptHash,
        acceptedAt: new Date().toISOString(),
      },
    });
  }

  private async onTaskProposal(envelope: AzzleEnvelope): Promise<void> {
    if (this.config.role !== "worker") return;
    const payload = envelope.payload as {
      settlementDigestPreview: string;
    };
    const expected = buildSettlementDigest(this.terms);
    if (payload.settlementDigestPreview !== expected) {
      throw new Error("TaskProposal digest preview mismatch");
    }
  }

  private async onTaskCounterOffer(envelope: AzzleEnvelope): Promise<void> {
    if (this.config.role !== "poster") return;
    const payload = envelope.payload as { settlementDigestPreview: string };
    const expected = buildSettlementDigest(this.terms);
    if (payload.settlementDigestPreview !== expected) {
      throw new Error("TaskCounterOffer digest preview mismatch");
    }
  }

  private async onTaskAcceptance(envelope: AzzleEnvelope): Promise<void> {
    const payload = envelope.payload as {
      settlementDigest: string;
      posterSignature: string;
      workerSignature: string;
    };
    const expected = buildSettlementDigest(this.terms);
    if (payload.settlementDigest !== expected) {
      throw new Error("TaskAcceptance settlement digest mismatch");
    }

    const counterparty = this.config.counterpartyEvm.toLowerCase();
    const poster = this.terms.poster.toLowerCase();
    const worker = this.terms.worker.toLowerCase();

    assertCounterpartySignature(
      payload.settlementDigest,
      payload.posterSignature,
      poster,
      poster,
      worker,
      this.config.chainId
    );
    assertCounterpartySignature(
      payload.settlementDigest,
      payload.workerSignature,
      worker,
      poster,
      worker,
      this.config.chainId
    );

    const counterpartySig =
      this.config.role === "poster" ? payload.workerSignature : payload.posterSignature;
    assertCounterpartySignature(
      payload.settlementDigest,
      counterpartySig,
      counterparty,
      poster,
      worker,
      this.config.chainId
    );

    const hasBoth =
      payload.posterSignature.length > 2 && payload.workerSignature.length > 2;
    if (!hasBoth) return;

    const state = this.negotiationState(envelope.negotiationId);
    const existingTaskId =
      this.transport.negotiationToTaskId.get(envelope.negotiationId);

    if (existingTaskId === undefined) {
      throw new Error("TaskAcceptance requires a bound, already-posted V2 task");
    }

    const onChain = await this.config.azzle.getTask(BigInt(existingTaskId));
    if (
      (envelope.taskId !== undefined && envelope.taskId !== existingTaskId) ||
      onChain.poster.toLowerCase() !== poster ||
      onChain.worker.toLowerCase() !== worker
    ) {
      throw new Error(
        `TaskAcceptance does not match bound on-chain task ${existingTaskId}`
      );
    }
    this.transport.bindTaskId(envelope.negotiationId, existingTaskId);
    const accepted: TaskAcceptedInfo = {
      envelope,
      settlementDigest: payload.settlementDigest,
      taskId: existingTaskId,
      createdOnChain: false,
    };
    state.taskId = accepted.taskId;
    state.accepted = accepted;
    await this.callbacks.onTaskAccepted?.(accepted);
  }

  private async onRevisionRequest(envelope: AzzleEnvelope): Promise<void> {
    if (this.config.role !== "worker") return;
    const payload = envelope.payload as unknown as RevisionRequestPayload;
    this.negotiationState(envelope.negotiationId).revisionRequests.push(payload);
    await this.callbacks.onRevisionRequested?.(payload, envelope);
  }

  private async onDeliveryNotice(envelope: AzzleEnvelope): Promise<void> {
    if (this.config.role !== "poster") return;
    const payload = envelope.payload as unknown as DeliveryNoticePayload;
    this.negotiationState(envelope.negotiationId).deliveries.push(payload);
    const boundTaskId = this.requireBoundSettlementTask(envelope, payload.taskId);
    await this.requireSettlementParties(boundTaskId);

    const taskId = BigInt(boundTaskId);
    const task = await this.config.azzle.getTask(taskId);
    const verified = task.stateName === "ACTIVE" && task.deliveredAt > 0n;

    const decision: DeliveryDecision = {
      envelope,
      payload,
      onChainDelivered: verified,
      onChainReceiptHash: ZERO_HASH,
      verified,
      accept: async () => {
        this.requireBoundSettlementTask(envelope, payload.taskId);
        await this.requireSettlementParties(boundTaskId);
        await this.sendAcceptDelivery(envelope.negotiationId, {
          taskId: payload.taskId,
          receiptHash: payload.receiptHash,
        });
      },
    };

    if (!verified) {
      console.warn("[negotiation] DeliveryNotice is not backed by an on-chain V2 delivery assertion", {
        taskId: payload.taskId,
        announced: payload.receiptHash,
        state: task.stateName,
      });
    }

    if (this.autoAccept && verified) {
      await decision.accept();
    }
    await this.callbacks.onDeliveryNotice?.(decision);
  }

  private async onAcceptDelivery(envelope: AzzleEnvelope): Promise<void> {
    if (this.config.role !== "worker") return;
    const payload = envelope.payload as unknown as AcceptDeliveryPayload;
    this.negotiationState(envelope.negotiationId).acceptedDeliveries.push(payload);
    await this.callbacks.onPaymentNotice?.(payload, envelope);
  }

  private async onPaymentRequest(envelope: AzzleEnvelope): Promise<void> {
    const payload = envelope.payload as unknown as PaymentRequestPayload;
    this.negotiationState(envelope.negotiationId).paymentRequests.push(payload);
    if (this.config.role !== "poster") return;
    const boundTaskId = this.requireBoundSettlementTask(envelope, payload.taskId);
    await this.requireSettlementParties(boundTaskId);

    const task = await this.config.azzle.getTask(BigInt(boundTaskId));
    const onChainDelivered = task.stateName === "ACTIVE" && task.deliveredAt > 0n;
    const verified = onChainDelivered;

    const decision: PaymentDecision = {
      envelope,
      payload,
      onChainDelivered,
      verified,
      approve: async () => {
        this.requireBoundSettlementTask(envelope, payload.taskId);
        await this.requireSettlementParties(boundTaskId);
        if (payload.releaseType === "full") {
          await this.config.azzle.complete(BigInt(boundTaskId));
          return;
        }
        if (payload.amount === undefined || BigInt(payload.amount) <= 0n) {
          throw new Error("Partial PaymentRequest requires a positive AZL wei amount");
        }
        await this.config.azzle.release(BigInt(boundTaskId), BigInt(payload.amount));
      },
    };

    if (this.autoAccept && verified) {
      await decision.approve();
    }
    await this.callbacks.onPaymentRequest?.(decision);
  }

  private async onCapabilityProof(envelope: AzzleEnvelope): Promise<void> {
    const payload = envelope.payload as unknown as CapabilityProofPayload;
    this.negotiationState(envelope.negotiationId).capabilityProofs.push(payload);
    await this.callbacks.onCapabilityProof?.(payload, envelope);
  }

  private async onDisputeEvidence(envelope: AzzleEnvelope): Promise<void> {
    const payload = envelope.payload as unknown as DisputeEvidencePayload;
    this.negotiationState(envelope.negotiationId).disputeEvidence.push(payload);
    await this.callbacks.onDisputeEvidence?.(payload, envelope);
  }

  private async onSupervisorVeto(envelope: AzzleEnvelope): Promise<void> {
    const payload = envelope.payload as unknown as SupervisorVetoPayload;
    this.negotiationState(envelope.negotiationId).veto = payload;
    console.warn("[negotiation] SupervisorVeto", payload.taskId, payload.reason);
    await this.callbacks.onSupervisorVeto?.(payload, envelope);
  }
}
