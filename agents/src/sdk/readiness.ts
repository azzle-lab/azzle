import type { OnChainTask } from "./client-v2.js";
import { parseTaskState, type V2TaskStateName } from "./task-state.js";

export interface TaskReadiness {
  state: V2TaskStateName | `UNKNOWN(${string})`;
  canClaim: boolean;
  canFund: boolean;
  canDeliver: boolean;
  canRelease: boolean;
  canComplete: boolean;
  canCancel: boolean;
  canExpire: boolean;
  canOpenDispute: boolean;
  reasons: string[];
}

export interface ReadinessOptions {
  now?: number;
  /** Poster address checking fund/release/cancel. */
  actor?: string;
  /** Worker address checking claim/deliver. */
  worker?: string;
}

function eqAddr(a?: string | null, b?: string | null): boolean {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

const ZERO = "0x0000000000000000000000000000000000000000";

/**
 * Protocol readiness for a loaded V2 task. Workers should call this instead of
 * inferring "can I markDelivered?" from ad-hoc state numbers.
 *
 * Ordering: POSTED → claim → CLAIMED → poster fund (full funding activates) →
 * ACTIVE → markDelivered → poster release/complete. Delivery is invalid before ACTIVE.
 */
export function taskReadiness(task: OnChainTask, options: ReadinessOptions = {}): TaskReadiness {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const parsed = parseTaskState(task.stateName ?? task.state);
  const state = parsed.name;
  const fullyFunded = task.totalAmount > 0n && task.funded >= task.totalAmount;
  const delivered = task.deliveredAt > 0n;
  const expired = Number(task.deadline) > 0 && Number(task.deadline) <= now;
  const fundingExpired = Number(task.fundingDeadline) > 0 && Number(task.fundingDeadline) <= now;
  const workerSet = task.worker && task.worker !== ZERO;
  const actorIsPoster = options.actor ? eqAddr(options.actor, task.poster) : true;
  const actorIsWorker = options.worker ? eqAddr(options.worker, task.worker) : true;
  const reasons: string[] = [];

  const canClaim = state === "POSTED" && !expired && !workerSet;
  if (state !== "POSTED") reasons.push(`claim requires POSTED (currently ${state})`);
  else if (expired) reasons.push("task deadline has passed");

  const canFund = (state === "CLAIMED" || (state === "ACTIVE" && !fullyFunded)) && actorIsPoster && !expired;
  if (state === "POSTED") reasons.push("fund is after claim — worker claims first, then poster funds");
  if (state === "CLAIMED" && fundingExpired) reasons.push("funding window expired — anyone may expire()");

  const canDeliver = state === "ACTIVE" && fullyFunded && !delivered && !expired && actorIsWorker;
  if (state === "CLAIMED") reasons.push("delivery is invalid until the poster fully funds and the task is ACTIVE");
  if (state === "ACTIVE" && delivered) reasons.push("already marked delivered");
  if (state === "ACTIVE" && expired) reasons.push("deadline passed — cannot markDelivered");

  const canRelease = state === "ACTIVE" && delivered && actorIsPoster && task.funded > task.released;
  const canComplete = canRelease;
  const canCancel = (state === "POSTED" || state === "CLAIMED") && task.funded === 0n && actorIsPoster;
  const canExpire =
    (["POSTED", "CLAIMED", "ACTIVE"].includes(state) && expired) ||
    (state === "CLAIMED" && fundingExpired);
  const canOpenDispute =
    state === "ACTIVE" && fullyFunded && task.funded > task.released && (!delivered || now <= Number(task.deliveredAt) + 86_400);

  return {
    state,
    canClaim,
    canFund,
    canDeliver,
    canRelease,
    canComplete,
    canCancel,
    canExpire,
    canOpenDispute,
    reasons: [...new Set(reasons)],
  };
}
