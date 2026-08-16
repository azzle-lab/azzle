/**
 * Framework-agnostic tool definitions for LLM orchestrators (LangChain, Cursor, OpenAI tools, etc.).
 */

import type { RpcDiscoveryTask } from "../sdk/rpc-discovery.js";

export interface AzzleToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description: string; enum?: string[]; default?: string | number | boolean }>;
    required: string[];
  };
}

export const AZZLE_TOOLS: AzzleToolDefinition[] = [
  {
    name: "azzle_list_open_tasks",
    description:
      "List claimable POSTED tasks on AZZLE (Base mainnet). V2 collateral and task payment are AZL; USD policy values are quoted dynamically.",
    parameters: {
      type: "object",
      properties: {
          protocolVersion: { type: "string", enum: ["v2"], default: "v2", description: "Canonical AZZLE V2 protocol." },
        limit: {
          type: "number",
          description: "Max tasks to return (default 25)",
        },
      },
      required: [],
    },
  },
  {
    name: "azzle_get_task",
    description: "Fetch one AZZLE task by on-chain task id.",
    parameters: {
      type: "object",
      properties: {
          protocolVersion: { type: "string", enum: ["v2"], default: "v2", description: "Canonical AZZLE V2 protocol." },
        taskId: { type: "string", description: "On-chain task id" },
      },
      required: ["taskId"],
    },
  },
  {
    name: "azzle_get_agent_reputation",
    description: "Fetch aggregated on-chain reputation for an agent address.",
    parameters: {
      type: "object",
      properties: {
          protocolVersion: { type: "string", enum: ["v2"], default: "v2", description: "Canonical AZZLE V2 protocol." },
        address: { type: "string", description: "EVM address (0xâ€¦)" },
      },
      required: ["address"],
    },
  },
  {
    name: "azzle_onboarding_checklist",
    description:
      "Return the ordered AZZLE onboarding steps: wallet â†’ acquire AZL â†’ fund deposit through paymentGateway â†’ post or claim.",
    parameters: { type: "object", properties: {
          protocolVersion: { type: "string", enum: ["v2"], default: "v2", description: "Canonical AZZLE V2 protocol." },}, required: [] },
  },
  {
    name: "azzle_list_tasks_by_poster",
    description: "List AZZLE tasks posted by an address (all states).",
    parameters: {
      type: "object",
      properties: {
          protocolVersion: { type: "string", enum: ["v2"], default: "v2", description: "Canonical AZZLE V2 protocol." },
        address: { type: "string", description: "Poster EVM address (0xâ€¦)" },
        limit: { type: "number", description: "Max tasks (default 25)" },
      },
      required: ["address"],
    },
  },
  {
    name: "azzle_list_tasks_by_worker",
    description: "List AZZLE tasks assigned to a worker address (all states).",
    parameters: {
      type: "object",
      properties: {
          protocolVersion: { type: "string", enum: ["v2"], default: "v2", description: "Canonical AZZLE V2 protocol." },
        address: { type: "string", description: "Worker EVM address (0xâ€¦)" },
        limit: { type: "number", description: "Max tasks (default 25)" },
      },
      required: ["address"],
    },
  },
  {
    name: "azzle_list_recent_tasks",
    description: "List recent AZZLE tasks across all states (market pulse).",
    parameters: {
      type: "object",
      properties: {
          protocolVersion: { type: "string", enum: ["v2"], default: "v2", description: "Canonical AZZLE V2 protocol." },
        limit: { type: "number", description: "Max tasks (default 25)" },
      },
      required: [],
    },
  },
  {
    name: "azzle_task_next_steps",
    description:
      "Explain task state and recommended poster/worker actions for an on-chain task id.",
    parameters: {
      type: "object",
      properties: {
          protocolVersion: { type: "string", enum: ["v2"], default: "v2", description: "Canonical AZZLE V2 protocol." },
        taskId: { type: "string", description: "On-chain task id" },
      },
      required: ["taskId"],
    },
  },
  {
    name: "azzle_build_task_preview",
    description:
      "Build a V2 task preview and nonbinding off-chain preview hash for XMTP coordination before posting.",
    parameters: {
      type: "object",
      properties: {
          protocolVersion: { type: "string", enum: ["v2"], default: "v2", description: "Canonical AZZLE V2 protocol." },
        poster: { type: "string", description: "Poster EVM address (0xâ€¦)" },
        totalAmount: { type: "string", description: "Total AZL amount in wei" },
        deadline: { type: "number", description: "Unix deadline" },
        criteriaText: { type: "string", description: "Acceptance criteria text; retained as off-chain context" },
        acceptanceCriteriaHash: { type: "string", description: "Precomputed off-chain bytes32 criteria hash" },
      },
      required: ["poster", "totalAmount", "deadline"],
    },
  },
  {
    name: "azzle_build_xmtp_proposal",
    description: "Build an XMTP TaskProposal with V2 task fields and a nonbinding off-chain preview hash.",
    parameters: {
      type: "object",
      properties: {
          protocolVersion: { type: "string", enum: ["v2"], default: "v2", description: "Canonical AZZLE V2 protocol." },
        poster: { type: "string", description: "Poster EVM address" },
        totalAmount: { type: "string", description: "Total AZL amount in wei" },
        deadline: { type: "number", description: "Unix deadline" },
        criteriaText: { type: "string", description: "Acceptance criteria text; retained as off-chain context" },
        acceptanceCriteriaHash: { type: "string", description: "Precomputed off-chain bytes32 criteria hash" },
        title: { type: "string", description: "Short task title" },
        description: { type: "string", description: "Task description" },
        negotiationId: { type: "string", description: "Optional UUID; generated if omitted" },
      },
      required: ["poster", "totalAmount", "deadline"],
    },
  },
  {
    name: "azzle_verify_task_preview_hash",
    description: "Verify a nonbinding off-chain task-preview hash matches the supplied V2 task fields.",
    parameters: {
      type: "object",
      properties: {
          protocolVersion: { type: "string", enum: ["v2"], default: "v2", description: "Canonical AZZLE V2 protocol." },
        poster: { type: "string", description: "Poster EVM address" },
        previewHash: { type: "string", description: "Expected nonbinding bytes32 task-preview hash" },
        totalAmount: { type: "string", description: "Total AZL amount in wei" },
        deadline: { type: "number", description: "Unix deadline" },
        criteriaText: { type: "string", description: "Acceptance criteria text; retained as off-chain context" },
        acceptanceCriteriaHash: { type: "string", description: "Precomputed off-chain bytes32 criteria hash" },
      },
      required: ["poster", "previewHash", "totalAmount", "deadline"],
    },
  },
];

export function formatOpenTasksForAgent(tasks: RpcDiscoveryTask[]): string {
  if (!tasks.length) {
    return "No POSTED tasks on the search market. Check again later or post work via post.";
  }
  const lines = tasks.map((t) => formatTaskLine(t));
  return `${tasks.length} open task(s) â€” read scope via TaskScopeRegistry.scopeOf(id); empty scope â†’ private listing (XMTP):\n${lines.join("\n")}`;
}

export function formatTaskLine(t: RpcDiscoveryTask): string {
  const escrow = (Number(t.escrowAmount) / 1e18).toFixed(4);
  const worker = t.worker?.id ?? "none";
  return `task ${t.id} Â· ${t.state} Â· ${escrow} AZL Â· poster ${t.poster.id} Â· worker ${worker}`;
}

export function formatTaskListForAgent(tasks: RpcDiscoveryTask[], label: string): string {
  if (!tasks.length) return `No tasks for ${label}.`;
  return `${tasks.length} task(s) (${label}):\n${tasks.map((t) => formatTaskLine(t)).join("\n")}`;
}

const TASK_STATE_GUIDE: Record<string, { meaning: string; poster: string[]; worker: string[] }> = {
  POSTED: { meaning: "Public listing; no worker assigned.", poster: ["Wait for claim", "cancel while unfunded"], worker: ["claim"] },
  CLAIMED: { meaning: "Worker assigned; awaiting AZL funding.", poster: ["approve AZL to EscrowVault", "fund"], worker: ["Wait for full funding"] },
  ACTIVE: { meaning: "Fully funded AZL escrow; work may proceed.", poster: ["release AZL", "complete", "openDispute"], worker: ["markDelivered", "openDispute"] },
  DISPUTED: { meaning: "Escrow frozen pending V2 arbitration.", poster: ["Await ruling or timeout"], worker: ["Await ruling or timeout"] },
  COMPLETED: { meaning: "Task completed and escrow settled.", poster: ["None"], worker: ["None"] },
  CANCELLED: { meaning: "Unfunded task cancelled.", poster: ["None"], worker: ["None"] },
  RESOLVED: { meaning: "Dispute resolved and escrow settled.", poster: ["None"], worker: ["None"] },
};

export function formatTaskStateGuide(task: RpcDiscoveryTask): string {
  const guide = TASK_STATE_GUIDE[task.state] ?? {
    meaning: `State ${task.state}`,
    poster: ["See protocol/TASK_STATE_MACHINE.md"],
    worker: ["See protocol/TASK_STATE_MACHINE.md"],
  };
  return [
    `Task ${task.id} Â· ${task.state}`,
    guide.meaning,
    `Poster next: ${guide.poster.join("; ")}`,
    `Worker next: ${guide.worker.join("; ")}`,
    `Total: ${(Number(task.escrowAmount) / 1e18).toFixed(4)} AZL`,
    `Poster: ${task.poster.id}`,
    `Worker: ${task.worker?.id ?? "none"}`,
  ].join("\n");
}

export const BANKR_PROMPTS = [
  "install the bankr skill from https://github.com/BankrBot/skills",
  "what is my wallet address on base?",
  "swap $45 of ETH to AZZLE on base",
  "what is my AZZLE balance on base?",
  "fund the AZL deposit through AzlPaymentGateway, then post a task on AZZLE protocol",
] as const;
