/**
 * AZZLE HTTP gateway — Base RPC V2 market reads + stateless Streamable HTTP MCP.
 *
 * Usage:
 *   cd agents && npm run build && npm run gateway
 *   curl http://localhost:4020/v1/market/open
 *   POST http://localhost:4020/mcp
 */
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import { RpcDiscovery } from "../dist/sdk/rpc-discovery.js";
import { loadMarketManifest, resolveExpectedMarket } from "../dist/sdk/markets.js";
import { handleMcpHttp, MCP_HTTP_PATH } from "../mcp/http.mjs";

const PORT = Number(process.env.AZZLE_GATEWAY_PORT ?? "4020");
const RPC = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
const market = resolveExpectedMarket(process.env.AZZLE_MARKET);
const manifest = loadMarketManifest(market);
const provider = new ethers.JsonRpcProvider(RPC);
const indexer = new RpcDiscovery({ rpcUrl: RPC, market, manifest });

const __dirname = dirname(fileURLToPath(import.meta.url));
const SURFACES_ROOT = normalize(join(__dirname, "..", "..", "launch-skills"));

const STATIC_MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

async function serveStatic(pathname, res) {
  let rel = pathname === "/" ? "/index.html" : pathname;
  const filePath = normalize(join(SURFACES_ROOT, rel.replace(/^\//, "")));
  if (!filePath.startsWith(SURFACES_ROOT) || !existsSync(filePath)) {
    return false;
  }
  const ext = filePath.includes(".") ? filePath.slice(filePath.lastIndexOf(".")) : "";
  const body = await readFile(filePath);
  res.writeHead(200, {
    "Content-Type": STATIC_MIME[ext] ?? "application/octet-stream",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
  return true;
}

function json(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Accept, Authorization, X-Azzle-Payment-Receipt, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
    ...extraHeaders,
  });
  res.end(payload);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Accept, Authorization, X-Azzle-Payment-Receipt, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
    });
    res.end();
    return;
  }

  try {
    if (path === MCP_HTTP_PATH) {
      await handleMcpHttp(req, res);
      return;
    }

    if (req.method === "GET" && path === "/health") {
      json(res, 200, {
        ok: true,
        chainId: 8453,
        market,
        source: "base-rpc",
        mcp: { path: MCP_HTTP_PATH, transport: "streamable-http", stateless: true, allowlist: "read" },
      });
      return;
    }

    if (req.method === "GET" && path === "/v1/market/open") {
      const tasks = await indexer.getOpenTasks();
      json(res, 200, { count: tasks.length, tasks });
      return;
    }

    if (req.method === "GET" && path === "/v1/market/recent") {
      const limit = Number(url.searchParams.get("limit") ?? "25");
      const tasks = await indexer.getRecentTasks(limit);
      json(res, 200, { count: tasks.length, tasks });
      return;
    }

    if (req.method === "GET" && path === "/v1/leaderboard/reputation") {
      const limit = Number(url.searchParams.get("limit") ?? "25");
      const agents = await indexer.getTopAgents(limit);
      json(res, 200, { count: agents.length, agents });
      return;
    }

    if (req.method === "GET" && path === "/v1/leaderboard/verifiers") {
      const limit = Number(url.searchParams.get("limit") ?? "25");
      const agents = await indexer.getVerifierLeaderboard(limit);
      json(res, 200, { count: agents.length, agents });
      return;
    }

    const taskMatch = decodeURIComponent(path).match(/^\/v1\/tasks\/(v2:(?:standard|micro):\d+)$/);
    if (req.method === "GET" && taskMatch) {
      const task = await indexer.getTask(taskMatch[1]);
      if (!task) {
        json(res, 404, { error: "task not found" });
        return;
      }
      json(res, 200, { task });
      return;
    }

    if ((req.method === "GET" || req.method === "HEAD") && (await serveStatic(path, res))) {
      return;
    }

    json(res, 404, {
      error: "not_found",
      routes: [
        "GET /",
        "GET /market.html",
        "GET /leaderboard.html",
        "GET /treasury-dashboard.html",
        "GET /health",
        "POST /mcp",
        "GET /v1/market/open",
        "GET /v1/market/recent",
        "GET /v1/leaderboard/reputation",
        "GET /v1/leaderboard/verifiers",
        "GET /v1/tasks/v2:standard:N",
      ],
    });
  } catch (err) {
    json(res, 500, { error: err.message ?? String(err) });
  }
});

server.listen(PORT, () => {
  console.log(`[azzle-gateway] http://localhost:${PORT}`);
  console.log("[azzle-gateway] hub     GET /  (launch-skills UI)");
  console.log("[azzle-gateway] market  GET /market.html  ·  GET /v1/market/open");
  console.log("[azzle-gateway] mcp     POST /mcp  (stateless Streamable HTTP, read-only)");
});
