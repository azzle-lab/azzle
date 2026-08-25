import { test } from "node:test";
import assert from "node:assert/strict";
import { extractMessageText, parseJsonFromLlm, repairTruncatedJson } from "./json.js";

test("strips DeepSeek think tags then parses JSON", () => {
  const raw = `<think>planning the object</think>\n{"name":"crewai","azzle_fit":0.9}`;
  assert.deepEqual(parseJsonFromLlm(raw), { name: "crewai", azzle_fit: 0.9 });
});

test("reads reasoning_content when content is empty", () => {
  const text = extractMessageText({
    content: "",
    reasoning_content: '{"ok":true}',
  });
  assert.equal(text, '{"ok":true}');
  assert.deepEqual(parseJsonFromLlm(text), { ok: true });
});

test("empty or ellipsis content is a clear error, not a fake ellipsis log", () => {
  assert.throws(() => parseJsonFromLlm(""), /empty content/);
  assert.throws(() => parseJsonFromLlm("…"), /empty content/);
  assert.throws(() => parseJsonFromLlm("..."), /empty content/);
});

test("repairs truncated object cut mid-string", () => {
  const repaired = repairTruncatedJson('{"name":"camel","angle":"already runs agen');
  assert.ok(repaired);
  const parsed = JSON.parse(repaired!) as { name: string; angle: string };
  assert.equal(parsed.name, "camel");
  assert.equal(typeof parsed.angle, "string");
});
