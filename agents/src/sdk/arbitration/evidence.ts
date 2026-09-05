import type { AzzleV2Client } from "../client-v2.js";
import type { TaskRef } from "../markets.js";
import { parseTaskScope } from "../scope.js";
import type { DisputeRecord, TaskEvidenceBundle } from "./types.js";

export async function gatherTaskEvidence(
  client: AzzleV2Client,
  taskId: TaskRef | string,
  extras: { receiptHash?: string; artifactUrl?: string } = {},
): Promise<TaskEvidenceBundle> {
  const [task, scope] = await Promise.all([client.getTask(taskId), client.getScope(taskId).catch(() => "")]);
  let dispute: DisputeRecord | null = null;
  try {
    const row = await client.getDispute(taskId);
    if (row.status !== 0) dispute = row;
  } catch {
    dispute = null;
  }
  const parsed = parseTaskScope(scope);
  return {
    taskId: String(taskId),
    market: client.market,
    state: task.stateName,
    poster: task.poster,
    worker: task.worker,
    totalAmount: task.totalAmount,
    funded: task.funded,
    released: task.released,
    deadline: task.deadline,
    deliveredAt: task.deliveredAt,
    scope,
    parsedScope: parsed.kind === "empty" ? undefined : parsed.json ?? parsed,
    receiptHash: extras.receiptHash,
    artifactUrl: extras.artifactUrl,
    dispute,
    xmtpNote:
      "XMTP is an optional collaboration layer. Public tasks may have empty XMTP history; scope and receiptHash remain the verifiable record.",
  };
}
