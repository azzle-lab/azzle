import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { handleMcpHttp } from "./lib/mcp-http.js";

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
    await run(`http://127.0.0.1:${port}/mcp`);
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

test("hosted POST /mcp initializes and lists the read-only catalog", async () => {
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
    assert.deepEqual(names, [
      "azzle_list_open_tasks",
      "azzle_get_task_scope",
      "azzle_get_agent_reputation",
      "azzle_onboarding_checklist",
    ]);

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

test("GET /mcp serves a live landing page for browsers", async () => {
  await withMcpServer(async (url) => {
    const response = await fetch(url, {
      method: "GET",
      headers: { accept: "text/html" },
    });
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/html/);
    assert.match(text, /AZZLE MCP/);
    assert.match(text, /Live/);
  });
});

test("GET /mcp still rejects MCP SSE probes", async () => {
  await withMcpServer(async (url) => {
    const response = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json, text/event-stream" },
    });
    assert.equal(response.status, 405);
  });
});
