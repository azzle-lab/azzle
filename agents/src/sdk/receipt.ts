import { ethers } from "ethers";
import type { ExecutionReceipt } from "./types.js";

export function canonicalizeReceipt(receipt: Omit<ExecutionReceipt, "receiptHash">): string {
  const sorted = JSON.stringify(receipt, Object.keys(receipt).sort());
  return sorted;
}

export function hashReceipt(receipt: Omit<ExecutionReceipt, "receiptHash">): string {
  return ethers.keccak256(ethers.toUtf8Bytes(canonicalizeReceipt(receipt)));
}

/**
 * What a customer recomputes: the canonical JSON of the receipt **without**
 * `receiptHash`, keys sorted. Hash the deliverable bytes separately with
 * `hashDeliverable()` / `sha256Hex()` and put that digest in `artifacts[].hash`.
 */
export function receiptHashInput(receipt: ExecutionReceipt | Omit<ExecutionReceipt, "receiptHash">): string {
  const { receiptHash: _ignored, ...rest } = receipt as ExecutionReceipt;
  return canonicalizeReceipt(rest);
}

export function buildExecutionReceipt(params: {
  taskId: string;
  worker: string;
  artifacts: ExecutionReceipt["artifacts"];
  gitProvenance?: ExecutionReceipt["gitProvenance"];
  deterministicOutput?: ExecutionReceipt["deterministicOutput"];
  testResults?: ExecutionReceipt["testResults"];
  previousReceiptHash?: string;
  availability?: ExecutionReceipt["availability"];
}): ExecutionReceipt {
  const base = {
    schemaVersion: "azzle-receipt-v2" as const,
    taskId: params.taskId,
    worker: params.worker,
    completedAt: new Date().toISOString(),
    artifacts: params.artifacts,
    ...(params.gitProvenance ? { gitProvenance: params.gitProvenance } : {}),
    ...(params.deterministicOutput ? { deterministicOutput: params.deterministicOutput } : {}),
    ...(params.testResults ? { testResults: params.testResults } : {}),
    ...(params.previousReceiptHash ? { previousReceiptHash: params.previousReceiptHash } : {}),
    ...(params.availability ? { availability: params.availability } : {}),
  };
  const receiptHash = hashReceipt(base);
  return { ...base, receiptHash };
}
