/**
 * Shared AZZLE MCP server factory (stdio + Streamable HTTP).
 * Default catalog is read-only discovery. Writes stay on https://mcp.base.org.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { RpcDiscovery } from "../dist/sdk/rpc-discovery.js";
import { loadMarketManifest, resolveExpectedMarket } from "../dist/sdk/markets.js";
import {
  AZZLE_ONBOARDING_CHECKLIST,
  BANKR_PROMPTS,
  formatOpenTasksForAgent,
  formatTaskListForAgent,
  formatTaskScopeForAgent,
  formatTaskStateGuide,
  listedAzzleTools,
  resolveMcpAllowlist,
} from "../dist/tools/azzle-tools.js";
import { termFlagsFromMcpArgs } from "./mcp-term-flags.mjs";
import {
  buildTaskPreview,
  buildXmtpProposal,
  verifyTaskPreviewHash,
} from "./xmtp-helpers.mjs";

const MCP_VERSION = "0.5.0";
const WRITE_HINT =
  "Claims, deposits, and swaps are not on this server. Use https://mcp.base.org and wait for approvalUrl.";

export function createAzzleMcpServer({ allowlist } = {}) {
  const mode = resolveMcpAllowlist(allowlist);
  const tools = listedAzzleTools(mode);
  const allowed = new Set(tools.map((tool) => tool.name));
  const selectedMarket = resolveExpectedMarket(process.env.AZZLE_MARKET);
  const manifest = loadMarketManifest(selectedMarket);
  const indexerFor = (args) => {
    const requested = resolveExpectedMarket(args?.market ?? selectedMarket);
    if (requested !== selectedMarket) {
      throw new Error(`MCP server is bound to '${selectedMarket}', not '${requested}'.`);
    }
    return new RpcDiscovery({ market: selectedMarket, manifest });
  };

  const server = new Server(
    { name: "azzle", version: MCP_VERSION },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => {
      const inputSchema = structuredClone(t.parameters);
      if (inputSchema.properties.market) inputSchema.properties.market.default = selectedMarket;
      return { name: t.name, description: t.description, inputSchema };
    }),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const requestedVersion = String(args?.protocolVersion ?? "v2");
    if (requestedVersion !== "v2") {
      return { content: [{ type: "text", text: "Only AZZLE V2 is supported." }], isError: true };
    }
    if (!allowed.has(name)) {
      return {
        content: [
          {
            type: "text",
            text: `Tool ${name} is not in the default read-only catalog (open tasks, scopeOf, reputation, onboarding). ${WRITE_HINT}`,
          },
        ],
        isError: true,
      };
    }

    try {
      switch (name) {
        case "azzle_list_open_tasks": {
          const limit = Number(args?.limit ?? 25);
          const tasks = await indexerFor(args).getOpenTasks();
          const slice = tasks.slice(0, limit);
          return {
            content: [{ type: "text", text: formatOpenTasksForAgent(slice) }],
          };
        }
        case "azzle_get_task_scope": {
          const taskId = String(args?.taskId ?? "");
          const row = await indexerFor(args).getTaskScope(taskId);
          return {
            content: [{ type: "text", text: formatTaskScopeForAgent(row) }],
          };
        }
        case "azzle_get_task": {
          const taskId = String(args?.taskId ?? "");
          const task = await indexerFor(args).getTask(taskId);
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
          const agent = await indexerFor(args).getAgentReputation(address);
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
          const extra =
            mode === "extended"
              ? ["", "Bankr prompts:", ...BANKR_PROMPTS.map((p) => `  ${p}`)].join("\n")
              : "";
          return {
            content: [{ type: "text", text: `${AZZLE_ONBOARDING_CHECKLIST}${extra}` }],
          };
        }
        case "azzle_list_tasks_by_poster": {
          const address = String(args?.address ?? "");
          const limit = Number(args?.limit ?? 25);
          const tasks = await indexerFor(args).getTasksByPoster(address, limit);
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
          const tasks = await indexerFor(args).getTasksByWorker(address, limit);
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
          const tasks = await indexerFor(args).getRecentTasks(limit);
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
          const task = await indexerFor(args).getTask(taskId);
          return {
            content: [
              {
                type: "text",
                text: task
                  ? `${formatTaskStateGuide(task)}\n${WRITE_HINT}`
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

  return server;
}
