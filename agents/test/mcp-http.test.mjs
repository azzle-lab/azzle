import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { handleMcpHttp, MCP_HTTP_PATH } from "../mcp/http.mjs";
import { AZZLE_MCP_READ_TOOLS } from "../dist/tools/azzle-tools.js";

const MCP_HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

async function withMcpServer(run) {
  const server = createServer((req, res) => {
    void handleMcpHttp(req, res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}${MCP_HTTP_PATH}`);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

async function rpc(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: MCP_HEADERS,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  assert.equal(response.status, 200, text);
  const json = JSON.parse(text);
  assert.equal(json.jsonrpc, "2.0");
  return json;
}

test("stateless POST /mcp initializes and lists the read-only catalog", async () => {
  await withMcpServer(async (url) => {
    const initialized = await rpc(url, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "azzle-test", version: "0.0.0" },
      },
    });
    assert.equal(initialized.result.serverInfo.name, "azzle");

    const listed = await rpc(url, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    const names = listed.result.tools.map((tool) => tool.name);
    assert.deepEqual(names, [...AZZLE_MCP_READ_TOOLS]);

    const onboarded = await rpc(url, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "azzle_onboarding_checklist", arguments: { protocolVersion: "v2" } },
    });
    const text = onboarded.result.content[0].text;
    assert.match(text, /read-only/);
    assert.match(text, /mcp\.base\.org/);

    const blocked = await rpc(url, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "azzle_get_task", arguments: { protocolVersion: "v2", taskId: "v2:standard:1" } },
    });
    assert.equal(blocked.result.isError, true);
    assert.match(blocked.result.content[0].text, /read-only catalog/);
  });
});

test("GET /mcp is rejected on the stateless HTTP surface", async () => {
  await withMcpServer(async (url) => {
    const response = await fetch(url, { method: "GET" });
    assert.equal(response.status, 405);
  });
});
