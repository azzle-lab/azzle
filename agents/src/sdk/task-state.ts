/**
 * V2 task states. `taskState()` on the registry returns uint8 as a BigInt
 * through ethers. Never compare that raw value to a plain number — `3n === 3`
 * is false, which is how workers miss ACTIVE after funding.
 */
export const V2_TASK_STATES = {
  NONE: 0,
  POSTED: 1,
  CLAIMED: 2,
  ACTIVE: 3,
  DISPUTED: 4,
  COMPLETED: 5,
  CANCELLED: 6,
  RESOLVED: 7,
} as const;

export type V2TaskStateName = keyof typeof V2_TASK_STATES;
export type V2TaskStateValue = (typeof V2_TASK_STATES)[V2TaskStateName];

export const V2_TASK_STATE_NAMES = [
  "NONE",
  "POSTED",
  "CLAIMED",
  "ACTIVE",
  "DISPUTED",
  "COMPLETED",
  "CANCELLED",
  "RESOLVED",
] as const satisfies readonly V2TaskStateName[];

export interface ParsedTaskState {
  /** Numeric enum value, safe to compare with `===`. */
  value: number;
  name: V2TaskStateName | `UNKNOWN(${string})`;
  /** Original ethers / ABI value when the input was a bigint. */
  raw: bigint;
}

export type TaskStateInput = bigint | number | string | ParsedTaskState | { state?: bigint | number | string; stateName?: string };

function asBigInt(value: bigint | number | string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`Invalid task state number '${value}'`);
    }
    return BigInt(value);
  }
  const trimmed = value.trim();
  const named = trimmed.toUpperCase();
  if (named in V2_TASK_STATES) return BigInt(V2_TASK_STATES[named as V2TaskStateName]);
  if (/^\d+$/.test(trimmed)) return BigInt(trimmed);
  throw new Error(`Unknown task state '${value}'. Use a V2 name or 0–7.`);
}

/** Normalize a registry `taskState` BigInt, a number, or a name such as `"ACTIVE"`. */
export function parseTaskState(input: TaskStateInput): ParsedTaskState {
  if (input && typeof input === "object") {
    if ("raw" in input && "value" in input && "name" in input) return input;
    if (input.stateName) return parseTaskState(input.stateName);
    if (input.state !== undefined) return parseTaskState(input.state);
  }
  const raw = asBigInt(input as bigint | number | string);
  const value = Number(raw);
  const name = V2_TASK_STATE_NAMES[value] ?? (`UNKNOWN(${value})` as const);
  return { value, name, raw };
}

export function isTaskState(input: TaskStateInput, expected: V2TaskStateName | V2TaskStateValue | bigint | number): boolean {
  const actual = parseTaskState(input);
  const want = parseTaskState(expected);
  return actual.value === want.value;
}

export function taskStateName(input: TaskStateInput): ParsedTaskState["name"] {
  return parseTaskState(input).name;
}

/** Use this instead of `state === 3` when the SDK or ethers returned a BigInt. */
export function taskStateEquals(left: TaskStateInput, right: TaskStateInput): boolean {
  return parseTaskState(left).value === parseTaskState(right).value;
}
