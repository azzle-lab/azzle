import { buildAuditScope } from "./scope.js";

export interface TaskTemplate {
  id: string;
  title: string;
  taskType: string;
  markets: Array<"standard" | "micro">;
  suggestedBudgetUsd: { min: number; max: number; default: number };
  inputHint: string;
  outputHint: string;
  buildScope: (input: string) => string;
}

function detectAuditInput(raw: string): { address?: string; githubUrl?: string; sourceUrl?: string; source?: string } {
  const text = raw.trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(text)) return { address: text };
  if (/github\.com/i.test(text)) return { githubUrl: text };
  if (/^https?:\/\//i.test(text)) return { sourceUrl: text };
  return { source: text };
}

export const TASK_TEMPLATES: Record<string, TaskTemplate> = {
  "solidity-audit": {
    id: "solidity-audit",
    title: "Solidity security audit",
    taskType: "solidity-audit",
    markets: ["micro", "standard"],
    suggestedBudgetUsd: { min: 10, max: 50, default: 30 },
    inputHint: "Paste a contract address, GitHub URL, BaseScan/Sourcify link, or Solidity source.",
    outputHint: "Code4rena-style report plus receiptHash of the report bytes.",
    buildScope: (input) => buildAuditScope({ ...detectAuditInput(input), title: "Smart contract security audit" }),
  },
  generic: {
    id: "generic",
    title: "Generic task",
    taskType: "generic",
    markets: ["micro", "standard"],
    suggestedBudgetUsd: { min: 1, max: 10_000, default: 25 },
    inputHint: "Describe the outcome the worker should deliver.",
    outputHint: "Artifact the poster can view, with a recomputable receiptHash.",
    buildScope: (input) => JSON.stringify({ taskType: "generic", description: input.trim() }),
  },
};

export function templateFor(id: string | undefined | null): TaskTemplate {
  return TASK_TEMPLATES[String(id ?? "generic")] ?? TASK_TEMPLATES.generic;
}
