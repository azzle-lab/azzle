/**
 * Stateless Streamable HTTP handler for POST /mcp.
 * Fresh server + transport per request. No session ids, no hot keys.
 */
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createAzzleMcpServer } from "./create-server.mjs";

export const MCP_HTTP_PATH = "/mcp";

export function applyMcpCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept, Authorization, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID"
  );
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id, MCP-Protocol-Version");
}

export async function handleMcpHttp(req, res) {
  applyMcpCors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, {
      Allow: "POST, OPTIONS",
      "Content-Type": "application/json",
    });
    res.end(
      JSON.stringify({
        error: "method_not_allowed",
        hint: "Stateless Streamable HTTP. POST JSON-RPC to /mcp.",
      })
    );
    return;
  }

  const server = createAzzleMcpServer({ allowlist: "read" });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  const close = async () => {
    try {
      await transport.close();
    } catch {
      /* already closed */
    }
    try {
      await server.close();
    } catch {
      /* already closed */
    }
  };
  res.on("close", () => {
    void close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32603, message: err.message ?? "Internal server error" },
          id: null,
        })
      );
    }
    await close();
  }
}
