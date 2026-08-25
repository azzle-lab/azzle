#!/usr/bin/env node
/**
 * AZZLE MCP server — stdio transport for Cursor / Grok Build.
 *
 * Prerequisite: cd agents && npm run build
 * Default catalog: open tasks, scopeOf, reputation, onboarding (AZZLE_MCP_ALLOWLIST=read).
 * Writes: https://mcp.base.org + approvalUrl.
 * HTTP: POST https://www.azzle.org/mcp (Vercel) or POST /mcp on the local gateway.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createAzzleMcpServer } from "./create-server.mjs";

const server = createAzzleMcpServer();
const transport = new StdioServerTransport();
await server.connect(transport);
