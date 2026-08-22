import { Contract } from "ethers";

const ARBITRATION_ABI = [
  "function disputes(uint256 taskId) view returns (uint256 taskId,address opener,address arbitrator,bytes32 posterEvidence,bytes32 workerEvidence,uint64 evidenceDeadline,uint64 rulingDeadline,uint8 status,uint8 outcome,uint256 slashed)",
];

export async function readDispute(provider, manifest, localTaskId) {
  const mod = new Contract(manifest.arbitrationModule, ARBITRATION_ABI, provider);
  return mod.disputes(localTaskId);
}

export async function isResolutionTimedOut(provider, manifest, localTaskId, nowSec = BigInt(Math.floor(Date.now() / 1000))) {
  const d = await readDispute(provider, manifest, localTaskId);
  const evidenceDeadline = BigInt(d.evidenceDeadline ?? d[5]);
  const rulingDeadline = BigInt(d.rulingDeadline ?? d[6]);
  const deadline = rulingDeadline || evidenceDeadline;
  if (!deadline) return { timedOut: false, deadline: 0n };
  return {
    timedOut: nowSec > deadline,
    deadline,
    remainingSec: deadline > nowSec ? deadline - nowSec : 0n,
  };
}

export async function runResolutionWatchdog(client, provider, manifest, taskId) {
  const status = await isResolutionTimedOut(provider, manifest, client.resolveTaskRef(taskId));
  console.log("[watchdog] task dispute", taskId.toString(), status);
  if (status.timedOut) {
    console.log("[watchdog] V2 ruling deadline exceeded — calling timeout");
    const tx = await client.timeout(taskId);
    await tx.wait();
    return { action: "timeout", status };
  }
  console.log("[watchdog] time remaining (sec)", status.remainingSec.toString());
  return { action: "wait", status };
}
