/**
 * stdio MCP handshake smoke — what `grok mcp doctor` checks after npm run build.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { AZZLE_MCP_READ_TOOLS } from "../dist/tools/azzle-tools.js";

const root = dirname(fileURLToPath(import.meta.url));
const serverPath = join(root, "..", "mcp", "server.mjs");

function takeLines(buffer) {
  const text = buffer.toString("utf8");
  const parts = text.split("\n");
  const rest = parts.pop() ?? "";
  const json = [];
  for (const line of parts) {
    const trimmed = line.replace(/\r$/, "").trim();
    if (!trimmed) continue;
    json.push(JSON.parse(trimmed));
  }
  return { json, rest: Buffer.from(rest, "utf8") };
}

test("stdio azzle MCP handshake lists the read-only catalog", async () => {
  const child = spawn(process.execPath, [serverPath], {
    cwd: join(root, ".."),
    env: { ...process.env, AZZLE_MCP_ALLOWLIST: "read" },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdout = Buffer.alloc(0);
  const messages = [];
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  child.stdout.on("data", (chunk) => {
    stdout = Buffer.concat([stdout, chunk]);
    const parsed = takeLines(stdout);
    messages.push(...parsed.json);
    stdout = parsed.rest;
  });

  const send = (payload) => {
    child.stdin.write(`${JSON.stringify(payload)}\n`);
  };

  try {
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "azzle-doctor", version: "0.0.0" },
      },
    });

    const initialized = await waitFor(() => messages.find((m) => m.id === 1), 8000);
    assert.equal(initialized.result.serverInfo.name, "azzle");

    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });

    const listed = await waitFor(() => messages.find((m) => m.id === 2), 8000);
    assert.deepEqual(
      listed.result.tools.map((tool) => tool.name),
      [...AZZLE_MCP_READ_TOOLS]
    );
  } finally {
    child.stdin.end();
    child.kill();
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 1000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
});

function waitFor(pick, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      try {
        const value = pick();
        if (value) {
          clearInterval(timer);
          resolve(value);
          return;
        }
      } catch (err) {
        clearInterval(timer);
        reject(err);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`timed out waiting for MCP message${stderr ? `\n${stderr}` : ""}`));
      }
    }, 20);
  });
}
