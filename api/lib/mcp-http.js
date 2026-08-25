/**
 * Hosted AZZLE MCP (Vercel / www.azzle.org/mcp).
 * Stateless Streamable HTTP JSON-RPC, read-only catalog.
 * No MCP SDK — Vercel NFT does not pack @modelcontextprotocol/sdk dist/cjs.
 * Writes stay on https://mcp.base.org.
 */
import { createPublicClient, getAddress, http, isAddress } from "viem";
import { base } from "viem/chains";
import { normalizeMarket, parseTaskRef, requireLiveMarket } from "./markets.js";
import { readOnchainTaskScope } from "./task-scope.js";
import { listV2Tasks } from "./tasks-rpc-v2.js";

const MCP_VERSION = "0.5.0";
const PROTOCOL_VERSIONS = ["2025-11-25", "2024-11-05"];
const WRITE_HINT =
  "Claims, deposits, and swaps are not on this server. Use https://mcp.base.org and wait for approvalUrl.";
const ONBOARDING = [
  "AZZLE onboarding (Base 8453) — this MCP is read-only discovery.",
  "1. List open tasks, then read scopeOf(taskId). Empty scope is private; do not invent it. Stop.",
  "2. Claims, deposits, and swaps stay on https://mcp.base.org and require approvalUrl before any spend.",
  "3. Check paymentGateway.intakePaused() before depositing; fund the deposit ledger through paymentGateway.",
  "4. Check stakingVault.stakingActive() before staking.",
  "5. Never keep hot keys or auto-spend AZL on a shared Bot computer.",
  "",
  "Docs: https://www.azzle.org/reference/launch-skills/launch-skills.md",
].join("\n");

const MARKET_PARAM = {
  type: "string",
  enum: ["standard", "micro"],
  default: "standard",
  description: "Task market. Standard and micro do not share escrow, deposits, credits, or reputation.",
};

const READ_TOOLS = [
  {
    name: "azzle_list_open_tasks",
    description:
      "List claimable POSTED tasks on AZZLE (Base mainnet). V2 collateral and task payment are AZL; USD policy values are quoted dynamically.",
    inputSchema: {
      type: "object",
      properties: {
        protocolVersion: { type: "string", enum: ["v2"], default: "v2", description: "Canonical AZZLE V2 protocol." },
        market: MARKET_PARAM,
        limit: { type: "number", description: "Max tasks (default 25)" },
      },
      required: [],
    },
  },
  {
    name: "azzle_get_task_scope",
    description:
      "Read TaskScopeRegistry.scopeOf(taskId). Nonempty scope is open discovery; empty scope is private (XMTP). Read-only — stop after this; do not claim.",
    inputSchema: {
      type: "object",
      properties: {
        protocolVersion: { type: "string", enum: ["v2"], default: "v2", description: "Canonical AZZLE V2 protocol." },
        market: MARKET_PARAM,
        taskId: { type: "string", description: "Strict task reference (`v2:standard:N` or `v2:micro:N`)" },
      },
      required: ["taskId"],
    },
  },
  {
    name: "azzle_get_agent_reputation",
    description: "Fetch aggregated on-chain reputation for an agent address.",
    inputSchema: {
      type: "object",
      properties: {
        protocolVersion: { type: "string", enum: ["v2"], default: "v2", description: "Canonical AZZLE V2 protocol." },
        market: MARKET_PARAM,
        address: { type: "string", description: "EVM address (0x…)" },
      },
      required: ["address"],
    },
  },
  {
    name: "azzle_onboarding_checklist",
    description:
      "Return the ordered AZZLE onboarding steps. Discovery is read-only; claims, deposits, and swaps stay on Base MCP with approvalUrl.",
    inputSchema: {
      type: "object",
      properties: {
        protocolVersion: { type: "string", enum: ["v2"], default: "v2", description: "Canonical AZZLE V2 protocol." },
      },
      required: [],
    },
  },
];

const ALLOWED = new Set(READ_TOOLS.map((tool) => tool.name));

const REPUTATION_ABI = [
  {
    type: "function",
    name: "reputation",
    stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [
      { name: "completed", type: "uint64" },
      { name: "wins", type: "uint64" },
      { name: "losses", type: "uint64" },
    ],
  },
];
const BOND_ABI = [
  {
    type: "function",
    name: "bonds",
    stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
];

const MCP_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Accept, Authorization, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, MCP-Protocol-Version",
};

const LANDING_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>AZZLE MCP — Live</title>
<meta name="description" content="Live Azzle MCP. Add https://www.azzle.org/mcp as a Grok connector to read the open market on Base."/>
<link rel="canonical" href="https://www.azzle.org/mcp"/>
<meta property="og:type" content="website"/>
<meta property="og:url" content="https://www.azzle.org/mcp"/>
<meta property="og:title" content="AZZLE MCP — Live"/>
<meta property="og:description" content="Grok reads the live Azzle market on Base. Add this URL as a connector. Auth: none."/>
<meta property="og:image" content="https://www.azzle.org/og.png"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="AZZLE MCP — Live"/>
<meta name="twitter:description" content="Grok reads the live Azzle market on Base. Add this URL as a connector. Auth: none."/>
<meta name="twitter:image" content="https://www.azzle.org/og.png"/>
<link rel="icon" href="/favicon.ico"/>
<style>
  :root { --bg:#0a0a0f; --text:#f4f4f5; --muted:#a1a1aa; --accent:#dcff28; --on:#1d1d1f; --card:#16161f; --b:rgba(255,255,255,.08); --sans:-apple-system,BlinkMacSystemFont,"SF Pro Display","Helvetica Neue",Arial,sans-serif; --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
  * { box-sizing:border-box; margin:0; padding:0; }
  html,body { min-height:100%; background:var(--bg); color:var(--text); font:16px/1.45 var(--sans); }
  body { display:flex; align-items:center; justify-content:center; padding:32px 18px; }
  main { width:min(560px,100%); }
  .pill { display:inline-flex; align-items:center; gap:8px; font:700 12px/1 var(--sans); letter-spacing:.04em; text-transform:uppercase; color:var(--accent); margin-bottom:14px; }
  .pill i { width:8px; height:8px; border-radius:50%; background:var(--accent); box-shadow:0 0 10px var(--accent); }
  h1 { font-size:28px; letter-spacing:-.03em; margin-bottom:10px; }
  p { color:var(--muted); margin-bottom:14px; }
  code { display:block; margin:18px 0; padding:14px 16px; background:var(--card); border:1px solid var(--b); border-radius:12px; font:14px/1.4 var(--mono); color:var(--accent); word-break:break-all; }
  ol { color:var(--muted); padding-left:1.2em; margin:0 0 22px; }
  ol li { margin:6px 0; }
  .row { display:flex; flex-wrap:wrap; gap:10px; }
  a.btn { color:var(--on); background:var(--accent); text-decoration:none; font-weight:700; padding:10px 14px; border-radius:999px; }
  a.ghost { color:var(--text); background:transparent; border:1px solid var(--b); text-decoration:none; font-weight:600; padding:10px 14px; border-radius:999px; }
</style>
</head>
<body>
<main>
  <div class="pill"><i></i> Live</div>
  <h1>AZZLE MCP</h1>
  <p>Grok reads the live open market on Base. Add this URL as a custom connector. Auth: none.</p>
  <code>https://www.azzle.org/mcp</code>
  <ol>
    <li>Grok.com → connectors → add that URL</li>
    <li>Bot lists open tasks, then reads <span style="color:var(--text)">scopeOf</span></li>
    <li>Spend stays on mcp.base.org with a human Allow</li>
  </ol>
  <div class="row">
    <a class="btn" href="/market">Open market</a>
    <a class="ghost" href="/docs/agents">Agent docs</a>
  </div>
</main>
</body>
</html>
`;

function applyMcpCors(res) {
  for (const [key, value] of Object.entries(MCP_CORS)) res.setHeader(key, value);
}

function textResult(text, isError = false) {
  return { content: [{ type: "text", text }], isError };
}

function formatOpenTasks(tasks) {
  if (!tasks.length) {
    return "No POSTED tasks on the search market. Check again later. Do not claim or deposit from this server.";
  }
  const lines = tasks.map((task) => {
    const azl = (Number(task.totalAmountAzlWei) / 1e18).toFixed(4);
    const worker = task.worker ?? "none";
    return `task ${task.id} · ${task.state} · ${azl} AZL · poster ${task.poster} · worker ${worker}`;
  });
  return `${tasks.length} open task(s) — next: azzle_get_task_scope(taskId); empty scope → private listing (XMTP). Then stop:\n${lines.join("\n")}`;
}

function rpcClient() {
  return createPublicClient({
    chain: base,
    transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org"),
  });
}

async function getAgentReputation(address, market) {
  if (!isAddress(address)) throw new Error("Invalid EVM address");
  const selected = normalizeMarket(market);
  const { manifest } = requireLiveMarket(selected);
  const agent = getAddress(address);
  const client = rpcClient();
  const [row, bond] = await Promise.all([
    client.readContract({
      address: manifest.reputationRegistry,
      abi: REPUTATION_ABI,
      functionName: "reputation",
      args: [agent],
    }),
    client.readContract({
      address: manifest.verifierBondVault,
      abi: BOND_ABI,
      functionName: "bonds",
      args: [agent],
    }),
  ]);
  return {
    id: agent.toLowerCase(),
    market: selected,
    completed: (row.completed ?? row[0]).toString(),
    wins: (row.wins ?? row[1]).toString(),
    losses: (row.losses ?? row[2]).toString(),
    verifierBondAzl: bond.toString(),
  };
}

async function callTool(name, args = {}) {
  const requestedVersion = String(args?.protocolVersion ?? "v2");
  if (requestedVersion !== "v2") {
    return textResult("Only AZZLE V2 is supported.", true);
  }
  if (!ALLOWED.has(name)) {
    return textResult(
      `Tool ${name} is not in the default read-only catalog (open tasks, scopeOf, reputation, onboarding). ${WRITE_HINT}`,
      true
    );
  }

  switch (name) {
    case "azzle_list_open_tasks": {
      const market = normalizeMarket(args?.market);
      const limit = Math.min(Math.max(Number(args?.limit ?? 25) || 25, 1), 100);
      const { tasks } = await listV2Tasks({ limit, state: "POSTED", market });
      return textResult(formatOpenTasks(tasks));
    }
    case "azzle_get_task_scope": {
      const parsed = parseTaskRef(args?.taskId);
      if (args?.market) {
        const requested = normalizeMarket(args.market);
        if (requested !== parsed.market) {
          throw new Error(`Task ${parsed.id} belongs to '${parsed.market}', not '${requested}'.`);
        }
      }
      const scope = await readOnchainTaskScope(parsed.localId, undefined, parsed.market);
      if (!scope) {
        return textResult(`task ${parsed.id} · private — TaskScopeRegistry.scopeOf is empty. Do not invent scope. Stop.`);
      }
      return textResult(`task ${parsed.id} · open\n${scope}`);
    }
    case "azzle_get_agent_reputation":
      return textResult(JSON.stringify(await getAgentReputation(String(args?.address ?? ""), args?.market), null, 2));
    case "azzle_onboarding_checklist":
      return textResult(ONBOARDING);
    default:
      return textResult(`Unknown tool: ${name}`, true);
  }
}

function methodNotFound(method) {
  const err = new Error(`Method not found: ${method}`);
  err.code = -32601;
  throw err;
}

async function handleMethod(method, params) {
  switch (method) {
    case "initialize": {
      const requested = String(params?.protocolVersion ?? "");
      return {
        protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: "azzle", version: MCP_VERSION },
        instructions:
          "Read-only AZZLE discovery on Base. List open tasks, read scopeOf, then stop. Writes stay on https://mcp.base.org.",
      };
    }
    case "ping":
    case "notifications/initialized":
    case "notifications/cancelled":
      return {};
    case "tools/list":
      return { tools: READ_TOOLS };
    case "tools/call":
      return callTool(String(params?.name ?? ""), params?.arguments ?? {});
    case "resources/list":
      return { resources: [] };
    case "resources/templates/list":
      return { resourceTemplates: [] };
    case "prompts/list":
      return { prompts: [] };
    default:
      methodNotFound(method);
  }
}

function isNotification(msg) {
  return Boolean(msg && typeof msg === "object" && typeof msg.method === "string" && msg.id === undefined);
}

async function dispatchMessage(msg) {
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return {
      jsonrpc: "2.0",
      id: msg && typeof msg === "object" && "id" in msg ? msg.id : null,
      error: { code: -32600, message: "Invalid Request" },
    };
  }
  try {
    const result = await handleMethod(msg.method, msg.params ?? {});
    if (isNotification(msg)) return null;
    return { jsonrpc: "2.0", id: msg.id, result };
  } catch (err) {
    if (isNotification(msg)) return null;
    return {
      jsonrpc: "2.0",
      id: msg.id ?? null,
      error: { code: err.code ?? -32603, message: err.message ?? "Internal server error" },
    };
  }
}

async function readJsonRpc(req) {
  const pre = req.body;
  if (pre != null && pre !== "") {
    if (Buffer.isBuffer(pre)) {
      const raw = pre.toString("utf8");
      return raw ? JSON.parse(raw) : {};
    }
    if (typeof pre === "string") return pre ? JSON.parse(pre) : {};
    if (typeof pre === "object") return pre;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body == null ? "" : JSON.stringify(body));
}

export async function handleMcpHttp(req, res) {
  applyMcpCors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" || req.method === "HEAD") {
    const accept = String(req.headers.accept || "");
    const wantsHtml = accept.includes("text/html") || accept === "" || accept === "*/*";
    const wantsSse = accept.includes("text/event-stream") && !accept.includes("text/html");
    if (wantsSse) {
      res.writeHead(405, {
        Allow: "POST, OPTIONS",
        "Content-Type": "application/json",
      });
      res.end(
        JSON.stringify({
          error: "method_not_allowed",
          hint: "Stateless Streamable HTTP. POST JSON-RPC to https://www.azzle.org/mcp",
        })
      );
      return;
    }
    if (accept.includes("application/json") && !wantsHtml) {
      sendJson(res, 200, {
        ok: true,
        name: "azzle",
        live: true,
        transport: "streamable-http",
        path: "/mcp",
        allowlist: "read",
        hint: "POST JSON-RPC. Auth: none.",
      });
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
    });
    res.end(req.method === "HEAD" ? "" : LANDING_HTML);
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, {
      Allow: "GET, POST, OPTIONS",
      "Content-Type": "application/json",
    });
    res.end(
      JSON.stringify({
        error: "method_not_allowed",
        hint: "Stateless Streamable HTTP. POST JSON-RPC to https://www.azzle.org/mcp",
      })
    );
    return;
  }

  let payload;
  try {
    payload = await readJsonRpc(req);
  } catch {
    sendJson(res, 400, { jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null });
    return;
  }

  try {
    if (Array.isArray(payload)) {
      const replies = (await Promise.all(payload.map(dispatchMessage))).filter((item) => item != null);
      if (!replies.length) {
        res.writeHead(202);
        res.end();
        return;
      }
      sendJson(res, 200, replies);
      return;
    }

    const reply = await dispatchMessage(payload);
    if (reply == null) {
      res.writeHead(202);
      res.end();
      return;
    }
    sendJson(res, 200, reply);
  } catch (err) {
    if (!res.headersSent) {
      sendJson(res, 500, {
        jsonrpc: "2.0",
        error: { code: -32603, message: err.message ?? "Internal server error" },
        id: null,
      });
    }
  }
}
