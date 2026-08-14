import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AzzleEnvelope } from "./types.js";
import { ENVELOPE_SCHEMA_VERSION } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** @azzle/agents package root (dist/sdk/xmtp → ../../../) */
const PACKAGE_ROOT = join(__dirname, "../../..");
const SPEC_SCHEMAS = join(PACKAGE_ROOT, "schemas/xmtp");
const PROTOCOL_STANDARDS = join(PACKAGE_ROOT, "schemas/standards");

function loadJson(path: string): object {
  return JSON.parse(readFileSync(path, "utf8")) as object;
}

let ajv: Ajv2020 | null = null;
let validateEnvelopeFn: ValidateFunction | undefined;
let payloadValidators: Record<string, ValidateFunction> = {};

function ensureValidators(): void {
  if (ajv) return;

  if (!existsSync(join(SPEC_SCHEMAS, "envelope.json"))) {
    throw new Error(
      `@azzle/agents: XMTP schemas missing at ${SPEC_SCHEMAS}. Reinstall the package or report a packaging bug.`
    );
  }

  ajv = new Ajv2020({ allErrors: true, strict: false });
  (addFormats as unknown as (instance: Ajv2020) => void)(ajv);

  ajv.addSchema(loadJson(join(PROTOCOL_STANDARDS, "task-schema.json")));
  for (const file of [
    "envelope.json",
    "identity-link.json",
    "task-proposal.json",
    "task-counter-offer.json",
    "task-acceptance.json",
    "milestone-definition.json",
    "revision-request.json",
    "delivery-notice.json",
    "payment-request.json",
    "capability-proof.json",
    "dispute-evidence.json",
    "arbitrator-proposal.json",
    "mutual-cancel.json",
    "replacement-context.json",
    "supervisor-veto.json",
    "accept-delivery.json",
    "milestone-claim.json",
    "dispute-notice.json",
    "verification-attest.json",
    "dismiss-intent.json",
  ]) {
    ajv.addSchema(loadJson(join(SPEC_SCHEMAS, file)));
  }

  validateEnvelopeFn = ajv.getSchema("https://azzle.org/schemas/xmtp/envelope/v2") as ValidateFunction;

  payloadValidators = {
    TaskProposal: ajv.getSchema("https://azzle.org/schemas/xmtp/task-proposal/v2")!,
    TaskCounterOffer: ajv.getSchema("https://azzle.org/schemas/xmtp/task-counter-offer/v2")!,
    TaskAcceptance: ajv.getSchema("https://azzle.org/schemas/xmtp/task-acceptance/v2")!,
    MilestoneDefinition: ajv.getSchema("https://azzle.org/schemas/xmtp/milestone-definition/v2")!,
    RevisionRequest: ajv.getSchema("https://azzle.org/schemas/xmtp/revision-request/v2")!,
    DeliveryNotice: ajv.getSchema("https://azzle.org/schemas/xmtp/delivery-notice/v2")!,
    PaymentRequest: ajv.getSchema("https://azzle.org/schemas/xmtp/payment-request/v2")!,
    CapabilityProof: ajv.getSchema("https://azzle.org/schemas/xmtp/capability-proof/v2")!,
    DisputeEvidence: ajv.getSchema("https://azzle.org/schemas/xmtp/dispute-evidence/v2")!,
    ArbitratorProposal: ajv.getSchema("https://azzle.org/schemas/xmtp/arbitrator-proposal/v2")!,
    MutualCancel: ajv.getSchema("https://azzle.org/schemas/xmtp/mutual-cancel/v2")!,
    ReplacementContext: ajv.getSchema("https://azzle.org/schemas/xmtp/replacement-context/v2")!,
    SupervisorVeto: ajv.getSchema("https://azzle.org/schemas/xmtp/supervisor-veto/v2")!,
    AcceptDelivery: ajv.getSchema("https://azzle.org/schemas/xmtp/accept-delivery/v2")!,
    IdentityLink: ajv.getSchema("https://azzle.org/schemas/xmtp/identity-link/v2")!,
    MilestoneClaim: ajv.getSchema("https://azzle.org/schemas/xmtp/milestone-claim/v2")!,
    DisputeNotice: ajv.getSchema("https://azzle.org/schemas/xmtp/dispute-notice/v2")!,
    VerificationAttest: ajv.getSchema("https://azzle.org/schemas/xmtp/verification-attest/v2")!,
    DismissIntent: ajv.getSchema("https://azzle.org/schemas/xmtp/dismiss-intent/v2")!,
  };
}

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly errors: unknown
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

function assertValid(validator: ValidateFunction | undefined, data: unknown, label: string) {
  if (!validator) {
    throw new ValidationError(`No validator for ${label}`, null);
  }
  if (!validator(data)) {
    throw new ValidationError(`Invalid ${label}`, validator.errors);
  }
}

export function validateEnvelopeShape(envelope: unknown): envelope is AzzleEnvelope {
  ensureValidators();
  if (!envelope || typeof envelope !== "object") {
    throw new ValidationError("Envelope must be an object", null);
  }
  const e = envelope as AzzleEnvelope;
  if (e.schemaVersion !== ENVELOPE_SCHEMA_VERSION) {
    throw new ValidationError(`schemaVersion must be ${ENVELOPE_SCHEMA_VERSION}`, null);
  }
  assertValid(validateEnvelopeFn, envelope, "envelope");
  const payloadValidator = payloadValidators[e.type];
  if (!payloadValidator) {
    throw new ValidationError(`Unknown message type: ${e.type}`, null);
  }
  assertValid(payloadValidator, e.payload, `payload for ${e.type}`);
  return true;
}

export function validatePayload(type: string, payload: unknown): void {
  ensureValidators();
  const payloadValidator = payloadValidators[type];
  if (!payloadValidator) {
    throw new ValidationError(`Unknown message type: ${type}`, null);
  }
  assertValid(payloadValidator, payload, `payload for ${type}`);
}
