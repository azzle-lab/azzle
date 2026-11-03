import assert from "node:assert/strict";
import test from "node:test";
import {
  createCampaign,
  formatAzl,
  joinCampaign,
  leaveCampaign,
  parseAzl,
  quorum,
} from "./lib/crowdfund-board.js";

test("pass count matches ceil(3n/5) through 200 wallets", () => {
  const first = [1, 2, 2, 3, 3, 4, 5, 5, 6, 6];
  for (let n = 1; n <= 200; n += 1) {
    const k = quorum(n);
    assert.equal(k, Math.floor((3 * n + 4) / 5));
    if (n <= 10) assert.equal(k, first[n - 1]);
    if (n === 1) continue;
    const prev = quorum(n - 1);
    if (n % 5 === 0 || n % 5 === 3) assert.equal(k, prev);
    else assert.equal(k, prev + 1);
  }
  assert.equal(quorum(200), 120);
});

test("a team starts at 1 of 1 and steps through the schedule", () => {
  const state = { campaigns: [] };
  const created = createCampaign(state, {
    title: "Audit the escrow notes",
    brief: "Three outside teams review the delivery notes.",
    market: "standard",
    totalAzl: "30",
    minJoinAzl: "5",
    openerName: "Opener",
    openerWallet: "0x1111111111111111111111111111111111111111",
    openerAmountAzl: "0",
  });
  assert.equal(created.signaturesLabel, "1 of 1");
  assert.equal(created.blockers, 1);
  assert.equal(created.nextJoin.signaturesLabel, "2 of 2");

  const second = joinCampaign(state, {
    id: created.id,
    name: "North",
    wallet: "0x2222222222222222222222222222222222222222",
    amountAzl: "10",
  });
  assert.equal(second.signaturesLabel, "2 of 2");
  assert.equal(second.blockers, 1);

  const third = joinCampaign(state, {
    id: created.id,
    name: "South",
    wallet: "0x3333333333333333333333333333333333333333",
    amountAzl: "10",
  });
  assert.equal(third.signaturesLabel, "2 of 3");
  assert.equal(third.pledgedAzl, "20");
  assert.equal(third.blockers, 2);
});

test("join rejects a short pledge, a duplicate wallet, and a pledge past the goal", () => {
  const state = { campaigns: [] };
  const created = createCampaign(state, {
    title: "Micro check",
    brief: "Check the notes.",
    market: "micro",
    totalAzl: "10",
    minJoinAzl: "4",
    openerName: "Opener",
  });
  assert.throws(
    () => joinCampaign(state, {
      id: created.id,
      name: "Small",
      wallet: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      amountAzl: "3",
    }),
    /Minimum join/,
  );
  joinCampaign(state, {
    id: created.id,
    name: "Fit",
    wallet: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    amountAzl: "6",
  });
  assert.throws(
    () => joinCampaign(state, {
      id: created.id,
      name: "Again",
      wallet: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      amountAzl: "4",
    }),
    /already on this bounty/,
  );
  assert.throws(
    () => joinCampaign(state, {
      id: created.id,
      name: "Over",
      wallet: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      amountAzl: "5",
    }),
    /pass the goal/,
  );
});

test("leave returns the roster to the previous pass count", () => {
  const state = { campaigns: [] };
  const created = createCampaign(state, {
    title: "Shared delivery",
    brief: "Two teams, then one leaves.",
    market: "standard",
    totalAzl: "20",
    minJoinAzl: "1",
    openerName: "Opener",
  });
  const wallet = "0xcccccccccccccccccccccccccccccccccccccccc";
  joinCampaign(state, { id: created.id, name: "Guest", wallet, amountAzl: "2" });
  const left = leaveCampaign(state, { id: created.id, wallet });
  assert.equal(left.signaturesLabel, "1 of 1");
  assert.equal(left.pledgedAzl, "0");
  assert.equal(left.members.length, 0);
});

test("AZL amounts keep six decimals", () => {
  assert.equal(formatAzl(parseAzl("1.5", "Goal")), "1.5");
  assert.equal(formatAzl(parseAzl("0.000001", "Goal")), "0.000001");
});
