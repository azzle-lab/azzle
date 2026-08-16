import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Interface } from "ethers";
import { AzzleV2Client, V2_TASK_STATE_NAMES } from "../dist/sdk/client-v2.js";
import { AZZLE_TOOLS, formatOpenTasksForAgent } from "../dist/tools/azzle-tools.js";

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
  assert.ok(AZZLE_TOOLS.length >= 8);
  for (const tool of AZZLE_TOOLS) {
    assert.deepEqual(tool.parameters.properties.protocolVersion.enum, ["v2"]);
  }
  assert.equal(typeof formatOpenTasksForAgent([]), "string");
});
