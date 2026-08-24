import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Interface } from "ethers";
import { AzzleV2Client, V2_TASK_STATE_NAMES } from "../dist/sdk/client-v2.js";
import { AZZLE_MCP_READ_TOOLS, AZZLE_TOOLS, formatOpenTasksForAgent, formatTaskScopeForAgent, listedAzzleTools } from "../dist/tools/azzle-tools.js";

const manifest = JSON.parse(await readFile(new URL("../deployments/base-8453.json", import.meta.url), "utf8"));
const expectedTask = ["address", "address", "uint256", "uint256", "uint256", "uint64", "uint64", "uint64", "uint8"];

test("SDK uses canonical V2 manifest and task tuple", () => {
  const client = new AzzleV2Client(manifest, "http://127.0.0.1:8545");
  assert.ok(client);
  assert.deepEqual(V2_TASK_STATE_NAMES, ["NONE", "POSTED", "CLAIMED", "ACTIVE", "DISPUTED", "COMPLETED", "CANCELLED", "RESOLVED"]);
  const source = new Interface(["function tasks(uint256) view returns (address,address,uint256,uint256,uint256,uint64,uint64,uint64,uint8)"]);
  assert.deepEqual(source.getFunction("tasks").outputs.map((output) => output.type), expectedTask);
});

test("MCP tool definitions are V2-only", () => {
  const names = AZZLE_TOOLS.map((tool) => tool.name);
  assert.equal(new Set(names).size, names.length);
  assert.ok(AZZLE_TOOLS.length >= 8);
  assert.ok(names.includes("azzle_get_task_scope"));
  for (const tool of AZZLE_TOOLS) {
    assert.deepEqual(tool.parameters.properties.protocolVersion.enum, ["v2"]);
  }
  assert.equal(typeof formatOpenTasksForAgent([]), "string");
});

test("default MCP allow-list is read-only discovery", () => {
  assert.deepEqual([...AZZLE_MCP_READ_TOOLS], [
    "azzle_list_open_tasks",
    "azzle_get_task_scope",
    "azzle_get_agent_reputation",
    "azzle_onboarding_checklist",
  ]);
  assert.deepEqual(
    listedAzzleTools("read").map((tool) => tool.name),
    [...AZZLE_MCP_READ_TOOLS]
  );
  assert.ok(listedAzzleTools("extended").length > listedAzzleTools("read").length);
  assert.equal(
    formatTaskScopeForAgent({
      taskId: "v2:standard:1",
      market: "standard",
      scope: "",
      discovery: "private",
    }).includes("Stop"),
    true
  );
});
