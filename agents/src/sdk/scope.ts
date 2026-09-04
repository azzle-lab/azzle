/**
 * Recommended public-scope formats. The protocol stores an unconstrained string;
 * these conventions stop workers from claiming jobs they cannot execute.
 */

export type ScopeRefusalCode =
  | "MISSING_INPUT"
  | "EMPTY_SCOPE"
  | "UNSUPPORTED_SOURCE"
  | "UNRESOLVABLE_CONTRACT"
  | "INCOMPATIBLE_TASK"
  | "PRIVATE_SCOPE_REQUIRED";

export interface ScopeValidation {
  ok: boolean;
  code?: ScopeRefusalCode;
  reason?: string;
  /** Customer-facing copy when a worker refuses before claim. */
  customerMessage?: string;
  parsed?: ParsedTaskScope;
}

export interface ParsedTaskScope {
  kind: "json" | "text" | "empty";
  raw: string;
  json?: Record<string, unknown>;
  address?: string;
  githubUrl?: string;
  sourceUrl?: string;
  source?: string;
  taskType?: string;
  title?: string;
  completionCriteria?: unknown;
}

export interface ScopePolicy {
  /** Task types this worker accepts, e.g. `solidity-audit`. */
  acceptedTaskTypes?: string[];
  /** If true, refuse empty public scope (private/XMTP jobs). Default true. */
  requirePublicScope?: boolean;
  /** Extra predicate after parsing. */
  resolve?: (parsed: ParsedTaskScope) => Promise<ScopeValidation> | ScopeValidation;
}

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const GITHUB_RE = /^https?:\/\/(?:www\.)?github\.com\//i;
const SOURCE_HOST_RE = /^https?:\/\/(?:(?:www\.)?(?:basescan\.org|etherscan\.io|sourcify\.dev|repo\.sourcify\.dev))\//i;
const SOLIDITY_HINT = /pragma solidity|contract\s+\w+/i;

export const AUDIT_SCOPE_EXAMPLES = {
  address: { address: "0x0000000000000000000000000000000000000001" },
  githubUrl: { githubUrl: "https://github.com/org/repo/blob/main/src/VulnerableBank.sol" },
  sourceUrl: { sourceUrl: "https://basescan.org/address/0x0000000000000000000000000000000000000001#code" },
  source: { source: "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.19;\ncontract VulnerableBank {}" },
} as const;

export function parseTaskScope(raw: string | null | undefined): ParsedTaskScope {
  const text = String(raw ?? "").trim();
  if (!text) return { kind: "empty", raw: "" };
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    if (json && typeof json === "object" && !Array.isArray(json)) {
      return {
        kind: "json",
        raw: text,
        json,
        address: pickString(json, ["address", "contract", "contractAddress"]),
        githubUrl: pickString(json, ["githubUrl", "github", "repo", "repository"]),
        sourceUrl: pickString(json, ["sourceUrl", "url", "basescan", "sourcify"]),
        source: pickString(json, ["source", "solidity", "code"]),
        taskType: pickString(json, ["taskType", "type", "kind"]),
        title: pickString(json, ["title", "name"]),
        completionCriteria: json.completionCriteria ?? json.acceptanceCriteria ?? json.doneWhen,
      };
    }
  } catch {
    /* not JSON — treat as prose / raw address / URL / source */
  }
  if (ADDRESS_RE.test(text)) return { kind: "text", raw: text, address: text };
  if (GITHUB_RE.test(text)) return { kind: "text", raw: text, githubUrl: text };
  if (SOURCE_HOST_RE.test(text) || /^https?:\/\//i.test(text)) return { kind: "text", raw: text, sourceUrl: text };
  if (SOLIDITY_HINT.test(text)) return { kind: "text", raw: text, source: text };
  return { kind: "text", raw: text };
}

function pickString(json: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = json[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function buildAuditScope(input: {
  address?: string;
  githubUrl?: string;
  sourceUrl?: string;
  source?: string;
  title?: string;
  completionCriteria?: unknown;
}): string {
  const body: Record<string, unknown> = {
    taskType: "solidity-audit",
    title: input.title ?? "Smart contract security audit",
  };
  if (input.address) body.address = input.address;
  if (input.githubUrl) body.githubUrl = input.githubUrl;
  if (input.sourceUrl) body.sourceUrl = input.sourceUrl;
  if (input.source) body.source = input.source;
  if (input.completionCriteria) body.completionCriteria = input.completionCriteria;
  return JSON.stringify(body);
}

function hasAuditInput(parsed: ParsedTaskScope): boolean {
  return Boolean(parsed.address || parsed.githubUrl || parsed.sourceUrl || parsed.source);
}

/**
 * Pre-claim check. Workers should refuse with `customerMessage` rather than
 * claiming a task they cannot execute — that was the OneDollarAudit / LoneStar
 * lesson: post-payment insufficiency wastes fees and churns customers.
 */
export function validateScope(raw: string | null | undefined, policy: ScopePolicy = {}): ScopeValidation {
  const requirePublic = policy.requirePublicScope !== false;
  const parsed = parseTaskScope(raw);
  if (parsed.kind === "empty") {
    if (!requirePublic) {
      return {
        ok: false,
        code: "PRIVATE_SCOPE_REQUIRED",
        parsed,
        reason: "No public scope. Private jobs must be negotiated over XMTP before claim.",
        customerMessage: "This task has no public scope. Share the brief with the worker over XMTP, or publish onchain scope.",
      };
    }
    return {
      ok: false,
      code: "EMPTY_SCOPE",
      parsed,
      reason: "Public scope is empty.",
      customerMessage:
        "We couldn't start this task: the public scope is empty. Add a verified BaseScan URL, GitHub repo, contract address, or Solidity source.",
    };
  }

  const types = policy.acceptedTaskTypes;
  if (types?.length) {
    const found = (parsed.taskType ?? "").toLowerCase();
    const compatible = !found || types.some((t) => found.includes(t.toLowerCase()) || t.toLowerCase().includes(found));
    const looksLikeAudit = types.some((t) => t.includes("audit")) && hasAuditInput(parsed);
    if (!compatible && !looksLikeAudit) {
      return {
        ok: false,
        code: "INCOMPATIBLE_TASK",
        parsed,
        reason: `Task type '${parsed.taskType || "unspecified"}' is outside ${types.join(", ")}.`,
        customerMessage: `This worker handles ${types.join(", ")} jobs. Update the task type or post a matching job.`,
      };
    }
  }

  if (types?.some((t) => t.includes("audit"))) {
    if (!hasAuditInput(parsed)) {
      return {
        ok: false,
        code: "MISSING_INPUT",
        parsed,
        reason: "Audit scope needs address, githubUrl, sourceUrl, or source.",
        customerMessage:
          "We couldn't resolve this contract. Add a verified BaseScan URL, GitHub repo, contract address, or Solidity source.",
      };
    }
    if (parsed.address && !ADDRESS_RE.test(parsed.address)) {
      return {
        ok: false,
        code: "UNRESOLVABLE_CONTRACT",
        parsed,
        reason: `Not a valid EVM address: ${parsed.address}`,
        customerMessage: "That contract address is not a valid EVM address. Paste a 0x address, GitHub URL, or Solidity source.",
      };
    }
    if (parsed.githubUrl && !GITHUB_RE.test(parsed.githubUrl) && !/^https?:\/\//i.test(parsed.githubUrl)) {
      return {
        ok: false,
        code: "UNSUPPORTED_SOURCE",
        parsed,
        reason: "githubUrl must be an http(s) GitHub URL.",
        customerMessage: "The GitHub link is not a URL we can fetch. Use a https://github.com/… link to the Solidity file or repo.",
      };
    }
  }

  return { ok: true, parsed };
}

export async function canClaimTask(
  scope: string | null | undefined,
  policy: ScopePolicy = {},
): Promise<ScopeValidation> {
  const base = validateScope(scope, policy);
  if (!base.ok || !policy.resolve || !base.parsed) return base;
  const extra = await policy.resolve(base.parsed);
  return extra.ok ? base : extra;
}

export function formatScopeRefusal(validation: ScopeValidation): string {
  if (validation.ok) return "scope ok";
  return `[${validation.code ?? "REFUSED"}] ${validation.customerMessage ?? validation.reason ?? "refused"}`;
}
