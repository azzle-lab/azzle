import type { AzzleV2Client } from "./client-v2.js";
import type { TaskRef } from "./markets.js";
import { isTaskState, parseTaskState, type TaskStateInput, type V2TaskStateName } from "./task-state.js";

export interface WaitForStateOptions {
  timeoutMs?: number;
  pollMs?: number;
  signal?: AbortSignal;
}

export class WaitForStateTimeout extends Error {
  readonly taskId: string;
  readonly expected: string;
  readonly lastState: string;
  constructor(taskId: string, expected: string, lastState: string, timeoutMs: number) {
    super(
      `Task ${taskId} did not reach ${expected} within ${Math.round(timeoutMs / 1000)}s (last state ${lastState}).`,
    );
    this.name = "WaitForStateTimeout";
    this.taskId = taskId;
    this.expected = expected;
    this.lastState = lastState;
  }
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error("aborted"));
      },
      { once: true },
    );
  });
}

/**
 * Poll until `getTask` reports the expected state. Accepts `"ACTIVE"` or `3`
 * and compares through parseTaskState, so BigInt registry values cannot miss
 * the transition the way `state === 3` did in the audit worker pilot.
 */
export async function waitForState(
  client: Pick<AzzleV2Client, "getTask">,
  taskId: TaskRef | string,
  expected: TaskStateInput,
  options: WaitForStateOptions = {},
): Promise<{ value: number; name: V2TaskStateName | `UNKNOWN(${string})`; raw: bigint }> {
  const timeoutMs = options.timeoutMs ?? 600_000;
  const pollMs = Math.max(options.pollMs ?? 3_000, 500);
  const deadline = Date.now() + timeoutMs;
  const want = parseTaskState(expected);
  let last = parseTaskState(0);
  for (;;) {
    const row = await client.getTask(taskId);
    last = parseTaskState(row.stateName ?? row.state);
    if (isTaskState(last, want.value)) return last;
    if (Date.now() >= deadline) {
      throw new WaitForStateTimeout(String(taskId), String(want.name), String(last.name), timeoutMs);
    }
    await sleep(pollMs, options.signal);
  }
}
