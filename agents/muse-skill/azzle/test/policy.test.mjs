import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const skillPath = new URL("../SKILL.md", import.meta.url);
const executorPath = new URL("../scripts/execute-v2.mjs", import.meta.url);

test("skill requires a dedicated Muse EOA and explicit write cap", async () => {
  const skill = await readFile(skillPath, "utf8");
  assert.match(skill, /MUSE_AZZLE_PRIVATE_KEY/);
  assert.match(skill, /MUSE_AZZLE_AUTONOMY=true/);
  assert.match(skill, /MUSE_AZZLE_MAX_WRITE_AZL_WEI/);
  assert.match(skill, /never sends the key outside\s+the Muse secret environment/i);
});

test("executor restricts writes to Base and the supported V2 lifecycle", async () => {
  const source = await readFile(executorPath, "utf8");
  assert.match(source, /network\.chainId !== 8453n/);
  assert.match(source, /MUSE_AZZLE_MAX_WRITE_AZL_WEI/);
  assert.match(source, /approve\(manifest\.escrowVault, amount\)/);
  assert.match(source, /actor: ownAddress/);
  assert.match(source, /claim", "fund", "mark-delivered", "release", "complete/);
});
