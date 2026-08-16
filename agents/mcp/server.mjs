#!/usr/bin/env node
/**
 * AZZLE MCP server — Base RPC discovery tools for Cursor / Claude Desktop.
 *
 * Prerequisite: cd agents && npm run build
 * Config: see launch-skills/DISTRIBUTION.md
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { RpcDiscovery } from "../dist/sdk/rpc-discovery.js";
import {
  AZZLE_TOOLS,
  BANKR_PROMPTS,
  formatOpenTasksForAgent,
  formatTaskListForAgent,
  formatTaskStateGuide,
} from "../dist/tools/azzle-tools.js";
import { termFlagsFromMcpArgs } from "./mcp-term-flags.mjs";
import {
  buildTaskPreview,
  buildXmtpProposal,
  verifyTaskPreviewHash,
} from "./xmtp-helpers.mjs";

const indexer = new RpcDiscovery();
const manifest = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../deployments/base-8453.json"), "utf8")
);
if (manifest.version !== "2.0.0" || manifest.chainId !== "8453") {
  throw new Error("AZZLE V2 manifest has the wrong version or chain");
}

const server = new Server(
  { name: "azzle", version: "0.4.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: AZZLE_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.parameters,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const requestedVersion = String(args?.protocolVersion ?? "v2");
  if (requestedVersion !== "v2") {
    return { content: [{ type: "text", text: "Only AZZLE V2 is supported." }], isError: true };
  }

  try {
    switch (name) {
      case "azzle_list_open_tasks": {
        const limit = Number(args?.limit ?? 25);
        const tasks = await indexer.getOpenTasks();
        const slice = tasks.slice(0, limit);
        return {
          content: [{ type: "text", text: formatOpenTasksForAgent(slice) }],
        };
      }
      case "azzle_get_task": {
        const taskId = String(args?.taskId ?? "");
        const task = await indexer.getTask(taskId);
        return {
          content: [
            {
              type: "text",
              text: task ? JSON.stringify(task, null, 2) : `Task ${taskId} not found`,
            },
          ],
        };
      }
      case "azzle_get_agent_reputation": {
        const address = String(args?.address ?? "");
        const agent = await indexer.getAgentReputation(address);
        return {
          content: [
            {
              type: "text",
              text: agent ? JSON.stringify(agent, null, 2) : `No agent ${address}`,
            },
          ],
        };
      }
      case "azzle_onboarding_checklist": {
        return {
          content: [
            {
              type: "text",
              text: [
                "AZZLE onboarding (Base 8453):",
                "1. Fund wallet with ETH + USDC on Base",
                "2. Acquire AZL for deposits and task funding",
                "3. Check paymentGateway.intakePaused() before depositing",
                "4. Fund the deposit ledger through paymentGateway",
                "5. Check stakingVault.stakingActive() before staking",
                "6. Post or claim a task; fund job escrow by approving escrowVault and calling fund",
                "",
                "Prepare helpers (agents/): npm run mcp:prepare -- hash-criteria --text \"...\"",
                "  npm run mcp:prepare -- hash-evidence --text \"...\"",
                "",
                "Bankr prompts:",
                ...BANKR_PROMPTS.map((p) => `  ${p}`),
                "",
                "Docs: https://www.azzle.org/reference/launch-skills/launch-skills.md",
              ].join("\n"),
            },
          ],
        };
      }
      case "azzle_list_tasks_by_poster": {
        const address = String(args?.address ?? "");
        const limit = Number(args?.limit ?? 25);
        const tasks = await indexer.getTasksByPoster(address, limit);
        return {
          content: [
            {
              type: "text",
              text: formatTaskListForAgent(tasks, `poster ${address}`),
            },
          ],
        };
      }
      case "azzle_list_tasks_by_worker": {
        const address = String(args?.address ?? "");
        const limit = Number(args?.limit ?? 25);
        const tasks = await indexer.getTasksByWorker(address, limit);
        return {
          content: [
            {
              type: "text",
              text: formatTaskListForAgent(tasks, `worker ${address}`),
            },
          ],
        };
      }
      case "azzle_list_recent_tasks": {
        const limit = Number(args?.limit ?? 25);
        const tasks = await indexer.getRecentTasks(limit);
        return {
          content: [
            {
              type: "text",
              text: formatTaskListForAgent(tasks, "recent"),
            },
          ],
        };
      }
      case "azzle_task_next_steps": {
        const taskId = String(args?.taskId ?? "");
        const task = await indexer.getTask(taskId);
        return {
          content: [
            {
              type: "text",
              text: task
                ? formatTaskStateGuide(task)
                : `Task ${taskId} not found`,
            },
          ],
        };
      }
      case "azzle_build_task_preview": {
        const flags = termFlagsFromMcpArgs(args);
        const result = buildTaskPreview(
          flags.from ?? String(args?.poster ?? ""),
          flags,
          manifest
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      case "azzle_build_xmtp_proposal": {
        const flags = termFlagsFromMcpArgs(args);
        const result = buildXmtpProposal(
          flags.from ?? String(args?.poster ?? ""),
          flags,
          manifest
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      case "azzle_verify_task_preview_hash": {
        const flags = termFlagsFromMcpArgs(args);
        const result = verifyTaskPreviewHash(
          flags.from ?? String(args?.poster ?? ""),
          flags,
          manifest
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (err) {
    return {
      content: [{ type: "text", text: err.message ?? String(err) }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
