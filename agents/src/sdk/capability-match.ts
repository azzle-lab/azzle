import type { CapabilityManifestV2, TaskMetadataV2 } from "./marketplace.js";
import { parseTaskScope, validateScope, type ScopeValidation } from "./scope.js";

export interface CapabilityMatch {
  score: number;
  ok: boolean;
  reasons: string[];
  matched: string[];
}

/**
 * Match a public scope / metadata blob against a worker capability manifest so
 * incompatible jobs (NFT-build vs Solidity audit) can be skipped before claim.
 */
export function matchWorkerCapabilities(
  scope: string | null | undefined,
  manifest: CapabilityManifestV2,
  metadata?: TaskMetadataV2 | null,
): CapabilityMatch {
  const parsed = parseTaskScope(scope);
  const reasons: string[] = [];
  const matched: string[] = [];
  const domains = new Set(manifest.capabilities.map((c) => c.domain.toLowerCase()));
  const ids = new Set(manifest.capabilities.map((c) => c.id.toLowerCase()));
  const acceptedInputs = new Set(manifest.capabilities.flatMap((c) => (c.inputFormats ?? []).map((f) => f.toLowerCase())));

  const required = metadata?.requiredCapabilities ?? [];
  for (const cap of required) {
    const key = cap.toLowerCase();
    if (ids.has(key) || domains.has(key)) matched.push(cap);
    else reasons.push(`missing capability ${cap}`);
  }

  const taskType = (parsed.taskType || metadata?.taskType || "").toLowerCase();
  if (taskType && !ids.has(taskType) && !domains.has(taskType) && ![...domains].some((d) => taskType.includes(d) || d.includes(taskType))) {
    reasons.push(`task type '${taskType}' is outside this worker's domains (${[...domains].join(", ") || "none"})`);
  }

  if (acceptedInputs.size) {
    const hasAddr = Boolean(parsed.address);
    const hasGit = Boolean(parsed.githubUrl);
    const hasUrl = Boolean(parsed.sourceUrl);
    const hasSrc = Boolean(parsed.source);
    const inputOk =
      (hasAddr && (acceptedInputs.has("address") || acceptedInputs.has("evm-address"))) ||
      (hasGit && (acceptedInputs.has("github") || acceptedInputs.has("githuburl"))) ||
      (hasUrl && (acceptedInputs.has("url") || acceptedInputs.has("sourceurl"))) ||
      (hasSrc && (acceptedInputs.has("source") || acceptedInputs.has("solidity"))) ||
      acceptedInputs.has("*");
    if (!inputOk && (hasAddr || hasGit || hasUrl || hasSrc || parsed.kind !== "empty")) {
      reasons.push(`inputs are not in accepted formats (${[...acceptedInputs].join(", ")})`);
    }
  }

  const ok = reasons.length === 0;
  return { score: ok ? 1 + matched.length : -1, ok, reasons, matched };
}

export function preClaimGate(
  scope: string | null | undefined,
  manifest: CapabilityManifestV2,
  acceptedTaskTypes?: string[],
): ScopeValidation {
  const scopeCheck = validateScope(scope, { acceptedTaskTypes, requirePublicScope: true });
  if (!scopeCheck.ok) return scopeCheck;
  const match = matchWorkerCapabilities(scope, manifest);
  if (!match.ok) {
    return {
      ok: false,
      code: "INCOMPATIBLE_TASK",
      parsed: scopeCheck.parsed,
      reason: match.reasons.join("; "),
      customerMessage: match.reasons[0] ?? "This worker cannot execute this task.",
    };
  }
  return scopeCheck;
}
