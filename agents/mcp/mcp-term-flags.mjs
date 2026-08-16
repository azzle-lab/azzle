/** Map MCP tool args → prepare/xmtp CLI flags. */
export function termFlagsFromMcpArgs(args = {}) {
  const flags = {};
  if (args.poster) flags.from = String(args.poster);
  if (args.from) flags.from = String(args.from);
  if (args.totalAmount != null) flags.total_amount = String(args.totalAmount);
  if (args.deadline != null) flags.deadline = String(args.deadline);
  if (args.criteriaText) flags.criteria_text = String(args.criteriaText);
  if (args.acceptanceCriteriaHash) {
    flags.acceptance_criteria_hash = String(args.acceptanceCriteriaHash);
  }
  if (args.title) flags.title = String(args.title);
  if (args.description) flags.description = String(args.description);
  if (args.negotiationId) flags.negotiation_id = String(args.negotiationId);
  if (args.previewHash) flags.preview_hash = String(args.previewHash);
  return flags;
}

export const TERM_TOOL_PROPERTIES = {
  poster: { type: "string", description: "Poster EVM address (0x…)" },
  totalAmount: { type: "string", description: "Total AZL amount in wei" },
  deadline: { type: "number", description: "Unix timestamp deadline" },
  criteriaText: { type: "string", description: "Acceptance criteria text; its hash is off-chain context" },
  acceptanceCriteriaHash: { type: "string", description: "Precomputed bytes32 criteria hash" },
  previewHash: { type: "string", description: "Expected nonbinding off-chain task-preview hash" },
};
