export interface TaskTerms {
  poster: string;
  worker: string;
  token?: string;
  totalAmount: bigint;
  deadline: number;
  acceptanceCriteriaHash: string;
  chainId: bigint;
  registryAddress: string;
}

/** Optional offchain delivery evidence. V2 does not submit or verify this onchain. */
export interface ExecutionReceipt {
  schemaVersion: "azzle-receipt-v2";
  taskId: string;
  worker: string;
  completedAt: string;
  artifacts: Array<{ type: string; hash: string; uri?: string }>;
  gitProvenance?: { repository?: string; commit?: string; diffHash?: string };
  deterministicOutput?: { inputHash?: string; outputHash?: string; verifierCommand?: string };
  testResults?: { passed?: number; failed?: number; reportHash?: string };
  previousReceiptHash?: string;
  availability?: {
    retrievalUri: string;
    verifiedAt: string;
    contentAddressed?: boolean;
  };
  receiptHash: string;
}

export const TASK_SCHEMA_VERSION = "azzle-task-v2";
