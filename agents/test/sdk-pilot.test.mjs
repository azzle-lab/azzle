import assert from "node:assert/strict";
import test from "node:test";
import {
  AUDIT_SCOPE_EXAMPLES,
  buildAuditScope,
  buildDeadline,
  canClaimTask,
  describeCustomerBalances,
  evaluateCriteria,
  formatScopeRefusal,
  GATEWAY_MAX_DEADLINE_WINDOW_SEC,
  gradeSandboxDecision,
  hashDeliverable,
  hashReceipt,
  buildExecutionReceipt,
  isTaskState,
  parseCompletionCriteria,
  parseTaskScope,
  parseTaskState,
  planDelivery,
  previewSettlement,
  recommendConcession,
  SANDBOX_CASES,
  TASK_TEMPLATES,
  taskReadiness,
  taskStateEquals,
  translateAzzleError,
  validateScope,
  V2_TASK_STATES,
} from "../dist/sdk/index.js";

test("taskState BigInt does not equal a plain number, but parseTaskState does", () => {
  assert.equal(3n === 3, false);
  assert.equal(parseTaskState(3n).value, 3);
  assert.equal(parseTaskState(3n).name, "ACTIVE");
  assert.equal(isTaskState(3n, "ACTIVE"), true);
  assert.equal(isTaskState(3n, V2_TASK_STATES.ACTIVE), true);
  assert.equal(taskStateEquals("ACTIVE", 3n), true);
  assert.equal(taskStateEquals(3, 3n), true);
});

test("readiness: claim before fund, deliver only when ACTIVE", () => {
  const posted = {
    poster: "0x1", worker: "0x0000000000000000000000000000000000000000",
    totalAmount: 10n, funded: 0n, released: 0n, deadline: 9_999_999_999n,
    fundingDeadline: 0n, deliveredAt: 0n, state: 1, stateName: "POSTED",
  };
  const postedReady = taskReadiness(posted, { now: 1 });
  assert.equal(postedReady.canClaim, true);
  assert.equal(postedReady.canFund, false);
  assert.equal(postedReady.canDeliver, false);

  const claimed = { ...posted, worker: "0x2", state: 2, stateName: "CLAIMED" };
  const claimedReady = taskReadiness(claimed, { now: 1, actor: "0x1" });
  assert.equal(claimedReady.canClaim, false);
  assert.equal(claimedReady.canFund, true);
  assert.equal(claimedReady.canDeliver, false);

  const active = { ...claimed, funded: 10n, state: 3, stateName: "ACTIVE" };
  const activeReady = taskReadiness(active, { now: 1, worker: "0x2" });
  assert.equal(activeReady.canDeliver, true);
  assert.equal(activeReady.canFund, false);
});

test("audit scope validation refuses empty and incompatible jobs", async () => {
  const empty = validateScope("", { acceptedTaskTypes: ["solidity-audit"] });
  assert.equal(empty.ok, false);
  assert.equal(empty.code, "EMPTY_SCOPE");
  assert.match(formatScopeRefusal(empty), /couldn't start/i);

  const nft = validateScope(JSON.stringify({ taskType: "nft-build", title: "mint" }), {
    acceptedTaskTypes: ["solidity-audit"],
  });
  assert.equal(nft.ok, false);
  assert.equal(nft.code, "INCOMPATIBLE_TASK");

  const addr = await canClaimTask(JSON.stringify(AUDIT_SCOPE_EXAMPLES.address), {
    acceptedTaskTypes: ["solidity-audit"],
  });
  assert.equal(addr.ok, true);
  assert.equal(parseTaskScope(buildAuditScope({ address: AUDIT_SCOPE_EXAMPLES.address.address })).address, AUDIT_SCOPE_EXAMPLES.address.address);
});

test("gateway helpers reject zero minAzlOut and 30-minute windows", async () => {
  const err = translateAzzleError(new Error("AzlGateway: deadline"));
  assert.match(err.message, /10 minutes/);
  const zero = translateAzzleError(new Error("AzlGateway: zero"));
  assert.match(zero.message, /minAzlOut/);
  assert.equal(GATEWAY_MAX_DEADLINE_WINDOW_SEC, 600);
  const fakeProvider = { getBlock: async () => ({ timestamp: 1_700_000_000 }) };
  const deadline = await buildDeadline(fakeProvider, { windowSeconds: 300 });
  assert.equal(deadline, 1_700_000_300);
  await assert.rejects(() => buildDeadline(fakeProvider, { windowSeconds: 1800 }), /1–600/);
});

test("receipt hashing is stable and independent of artifact location", () => {
  const report = JSON.stringify({ findings: ["reentrancy"] });
  const hash = hashDeliverable(report);
  const inline = planDelivery({ content: report });
  assert.equal(inline.mode, "inline");
  assert.match(inline.artifactUrl, /^data:application\/json;base64,/);
  const receipt = buildExecutionReceipt({
    taskId: "v2:micro:5",
    worker: "0x2",
    artifacts: [{ type: "audit-report", hash, uri: inline.artifactUrl }],
  });
  const { receiptHash: _h, ...unsigned } = receipt;
  assert.equal(receipt.receiptHash, hashReceipt(unsigned));
});

test("customer balances and micro template", () => {
  const pre = describeCustomerBalances({
    operatingUsd: 4,
    workBudgetUsd: 30,
    market: "micro",
    requiredFloorUsd: 5,
    taskBudgetUsd: 30,
  });
  assert.equal(pre.canSubmit, false);
  assert.equal(pre.operatingOk, false);
  const audit = TASK_TEMPLATES["solidity-audit"].buildScope("0x0000000000000000000000000000000000000001");
  assert.match(audit, /solidity-audit/);
});

test("arbitrator sandbox and settlement preview", () => {
  const accept = previewSettlement("ACCEPT_WORK");
  assert.equal(accept.onchain, true);
  assert.equal(accept.workerBps, 10_000);
  const rev = previewSettlement("REQUEST_REVISION");
  assert.equal(rev.onchain, false);
  const grade = gradeSandboxDecision("audit-complete", { intent: "ACCEPT_WORK" });
  assert.equal(grade.passed, true);
  assert.ok(SANDBOX_CASES.length >= 3);
});

test("completion criteria checklist", () => {
  const criteria = parseCompletionCriteria({
    items: [{ id: "findings", description: "Named issues", required: true }],
  });
  const miss = evaluateCriteria(criteria, {});
  assert.equal(miss.passed, false);
  const hit = evaluateCriteria(criteria, { findings: { met: true } });
  assert.equal(hit.passed, true);
  assert.equal(recommendConcession({ maxRevisions: 2, concedeOn: ["criteria_unmet"], defendOn: ["criteria_met"] }, { revision: 2, reasons: [] }), "concede");
});
