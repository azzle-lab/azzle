import { Contract, ethers } from "ethers";
import { loadManifest } from "./manifest.mjs";

const manifest = loadManifest(import.meta.url, "..", "base-8453.json");

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
];

/**
 * fund pulls AZL from the poster wallet into EscrowVault through TaskRegistryV2.
 * Ensure AZL allowance → EscrowVault before calling.
 */
export async function fundTaskEscrow(client, signer, taskId, amountAzlWei) {
  if (amountAzlWei <= 0n) throw new Error("Escrow funding amount must be positive AZL wei");
  const escrow = manifest.escrowVault;
  const azl = new Contract(manifest.external.azl, ERC20_ABI, signer);
  const allowance = await azl.allowance(await signer.getAddress(), escrow);
  if (allowance < amountAzlWei) {
    console.log("[escrow] approving AZL for EscrowVault");
    const tx = await azl.approve(escrow, ethers.MaxUint256);
    await tx.wait();
  }

  console.log("[escrow] funding AZL", { taskId: taskId.toString(), amountAzlWei: amountAzlWei.toString() });
  const tx = await client.fund(taskId, amountAzlWei);
  await tx.wait();
  console.log("[escrow] task escrow funded");
}

const TASK_STATE = { POSTED: 1, CLAIMED: 2, ACTIVE: 3 };

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wait for a worker claim before funding the V2 task escrow. */
export async function waitForWorkerClaim(client, taskId, options = {}) {
  const timeoutMs = options.timeoutMs ?? Number(process.env.CLAIM_TIMEOUT_MS ?? 300_000);
  const pollMs = options.pollMs ?? 3_000;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const state = await client.taskState(taskId);
    if (state === TASK_STATE.ACTIVE) {
      console.log("[escrow] task already ACTIVE", { taskId: taskId.toString() });
      return true;
    }
    if (state === TASK_STATE.CLAIMED) {
      console.log("[escrow] worker claimed task; ready to fund", { taskId: taskId.toString() });
      return true;
    }
    if (state !== TASK_STATE.POSTED) {
      console.warn("[escrow] unexpected task state — skipping funding", {
        taskId: taskId.toString(),
        state,
      });
      return false;
    }
    if (Date.now() >= deadline) {
      console.warn(
        `[escrow] no worker claimed task ${taskId} within ${Math.round(timeoutMs / 1000)}s — ` +
          "fund it after a worker claims"
      );
      return false;
    }
    await sleep(pollMs);
  }
}

export async function release(client, taskId, amountAzlWei) {
  if (amountAzlWei <= 0n) throw new Error("Release amount must be positive AZL wei");
  console.log("[escrow] release", { taskId: taskId.toString(), amountAzlWei: amountAzlWei.toString() });
  const tx = await client.release(taskId, amountAzlWei);
  await tx.wait();
}

export async function openDispute(client, taskId, evidenceHash) {
  const evidence =
    typeof evidenceHash === "string"
      ? ethers.getBytes(evidenceHash.length === 66 ? evidenceHash : ethers.id(evidenceHash))
      : evidenceHash;
  console.log("[escrow] openDispute", { taskId: taskId.toString() });
  const tx = await client.openDispute(taskId, evidence);
  await tx.wait();
}
