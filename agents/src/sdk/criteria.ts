export type CriteriaMode = "checklist" | "rubric" | "iterative";

export interface CompletionCriterion {
  id: string;
  description: string;
  required: boolean;
}

export interface CompletionCriteria {
  schemaVersion: "azzle-criteria-v1";
  mode: CriteriaMode;
  /** Explicit definition of "done", declared before funding when possible. */
  items: CompletionCriterion[];
  maxRevisions?: number;
  notes?: string;
}

export interface CriteriaEvaluation {
  passed: boolean;
  missing: CompletionCriterion[];
  checked: Array<CompletionCriterion & { met: boolean; evidence?: string }>;
}

export function parseCompletionCriteria(value: unknown): CompletionCriteria | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const items = Array.isArray(row.items) ? row.items : Array.isArray(row.checklist) ? row.checklist : null;
  if (!items) return null;
  const parsed: CompletionCriterion[] = [];
  for (const item of items) {
    if (typeof item === "string" && item.trim()) {
      parsed.push({ id: slug(item), description: item.trim(), required: true });
      continue;
    }
    if (item && typeof item === "object") {
      const rec = item as Record<string, unknown>;
      const description = String(rec.description ?? rec.text ?? rec.id ?? "").trim();
      if (!description) continue;
      parsed.push({
        id: String(rec.id ?? slug(description)),
        description,
        required: rec.required !== false,
      });
    }
  }
  if (!parsed.length) return null;
  const mode = row.mode === "rubric" || row.mode === "iterative" ? row.mode : "checklist";
  return {
    schemaVersion: "azzle-criteria-v1",
    mode,
    items: parsed,
    maxRevisions: typeof row.maxRevisions === "number" ? row.maxRevisions : undefined,
    notes: typeof row.notes === "string" ? row.notes : undefined,
  };
}

export function evaluateCriteria(
  criteria: CompletionCriteria,
  evidence: Record<string, { met: boolean; note?: string }>,
): CriteriaEvaluation {
  const checked = criteria.items.map((item) => ({
    ...item,
    met: Boolean(evidence[item.id]?.met),
    evidence: evidence[item.id]?.note,
  }));
  const missing = checked.filter((item) => item.required && !item.met);
  return { passed: missing.length === 0, missing, checked };
}

/** Agent parameter: when a delivery is disputed, how hard to push back vs revise. */
export interface ConcessionPolicy {
  maxRevisions: number;
  concedeOn: Array<"missing_evidence" | "scope_mismatch" | "criteria_unmet">;
  defendOn: Array<"finding_exists" | "criteria_met" | "reproducible_poc">;
}

export const DEFAULT_AUDIT_CONCESSION: ConcessionPolicy = {
  maxRevisions: 3,
  concedeOn: ["missing_evidence", "scope_mismatch", "criteria_unmet"],
  defendOn: ["finding_exists", "criteria_met", "reproducible_poc"],
};

export function recommendConcession(
  policy: ConcessionPolicy,
  context: { revision: number; reasons: string[] },
): "revise" | "defend" | "concede" {
  if (context.revision >= policy.maxRevisions) return "concede";
  if (context.reasons.some((r) => policy.concedeOn.includes(r as ConcessionPolicy["concedeOn"][number]))) {
    return "revise";
  }
  if (context.reasons.some((r) => policy.defendOn.includes(r as ConcessionPolicy["defendOn"][number]))) {
    return "defend";
  }
  return "revise";
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "item";
}
