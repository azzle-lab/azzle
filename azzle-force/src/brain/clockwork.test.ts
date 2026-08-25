import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateClockwork, resolveClockworkConfig } from "./clockwork.js";
import {
  mergePayingClients,
  payingClientsFromTasks,
  uniquePayingInWindow,
} from "../conversion/paying-clients.js";
import type { AzzleMarketTask } from "../tools/azzle.js";

test("SLA is OK when at least one unique paying client is in the hour", () => {
  const now = 1_700_000_000_000;
  const snap = evaluateClockwork({
    clients: [
      {
        address: "0x1111111111111111111111111111111111111111",
        role: "poster",
        taskId: "v2:standard:1",
        market: "standard",
        atMs: now - 10 * 60 * 1000,
        paidAzlWei: "1",
      },
    ],
    nowMs: now,
    config: resolveClockworkConfig(),
  });
  assert.equal(snap.ok, true);
  assert.equal(snap.breach, false);
  assert.equal(snap.uniquePayingLastHour, 1);
  assert.equal(snap.deficit, 0);
});

test("SLA is BREACH when no paying client arrived this hour", () => {
  const now = 1_700_000_000_000;
  const snap = evaluateClockwork({
    clients: [
      {
        address: "0x1111111111111111111111111111111111111111",
        role: "poster",
        taskId: "v2:standard:1",
        market: "standard",
        atMs: now - 2 * 60 * 60 * 1000,
        paidAzlWei: "1",
      },
    ],
    nowMs: now,
    config: resolveClockworkConfig(),
    previousConsecutiveBreaches: 2,
  });
  assert.equal(snap.ok, false);
  assert.equal(snap.breach, true);
  assert.equal(snap.uniquePayingLastHour, 0);
  assert.equal(snap.deficit, 1);
  assert.equal(snap.consecutiveBreaches, 3);
});

test("funded posters and claimed workers count as paying clients", () => {
  const tasks: AzzleMarketTask[] = [
    {
      id: "v2:standard:9",
      state: "POSTED",
      market: "standard",
      posterId: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      workerId: null,
      fundedAzlWei: "1000",
      escrowAmount: "1000",
    },
    {
      id: "v2:micro:3",
      state: "CLAIMED",
      market: "micro",
      posterId: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      workerId: "0xcccccccccccccccccccccccccccccccccccccccc",
      fundedAzlWei: "50",
      escrowAmount: "50",
    },
    {
      id: "v2:standard:8",
      state: "POSTED",
      market: "standard",
      posterId: "0xdddddddddddddddddddddddddddddddddddddddd",
      workerId: null,
      fundedAzlWei: "0",
      escrowAmount: "0",
    },
  ];
  const clients = payingClientsFromTasks(tasks, 100);
  assert.equal(clients.length, 3);
  assert.deepEqual(
    clients.map((c) => c.role).sort(),
    ["poster", "poster", "worker"]
  );
});

test("unique window collapses repeat wallets", () => {
  const now = 5000;
  const unique = uniquePayingInWindow(
    [
      {
        address: "0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa",
        role: "poster",
        taskId: "v2:standard:1",
        market: "standard",
        atMs: 4000,
        paidAzlWei: "1",
      },
      {
        address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        role: "worker",
        taskId: "v2:micro:2",
        market: "micro",
        atMs: 4500,
        paidAzlWei: "0",
      },
    ],
    now,
    2000
  );
  assert.equal(unique.length, 1);
});

test("merge keeps first-seen timestamp and drops stale rows", () => {
  const now = 10_000;
  const merged = mergePayingClients(
    [
      {
        address: "0x1111111111111111111111111111111111111111",
        role: "poster",
        taskId: "v2:standard:1",
        market: "standard",
        atMs: 100,
        paidAzlWei: "1",
      },
    ],
    [
      {
        address: "0x1111111111111111111111111111111111111111",
        role: "poster",
        taskId: "v2:standard:1",
        market: "standard",
        atMs: now,
        paidAzlWei: "1",
      },
      {
        address: "0x2222222222222222222222222222222222222222",
        role: "worker",
        taskId: "v2:micro:4",
        market: "micro",
        atMs: now,
        paidAzlWei: "0",
      },
    ],
    now,
    1000
  );
  assert.equal(merged.length, 2);
  const first = merged.find((c) => c.address.endsWith("1111"));
  const second = merged.find((c) => c.address.endsWith("2222"));
  assert.equal(first?.atMs, now);
  assert.equal(second?.address, "0x2222222222222222222222222222222222222222");
});
