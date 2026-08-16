import { ethers } from "ethers";

export function resolveCriteriaHash(flags, fail) {
  if (flags.criteria_text) {
    return ethers.id(flags.criteria_text);
  }
  const hash = flags.acceptance_criteria_hash;
  if (hash && (!ethers.isHexString(hash, 32))) {
    fail("--acceptance-criteria-hash must be bytes32");
  }
  return hash ?? null;
}

export function parseTaskPreview(from, flags, manifest, { fail }) {
  if (!ethers.isAddress(from)) {
    fail("--from must be a valid EVM address");
  }
  const totalAmount = BigInt(flags.total_amount ?? fail("--total-amount required (AZL wei)"));
  if (totalAmount <= 0n) {
    fail("--total-amount must be greater than zero");
  }
  const deadline = Number(flags.deadline ?? fail("--deadline required (unix seconds)"));
  if (!Number.isSafeInteger(deadline) || deadline <= 0) {
    fail("--deadline must be a positive Unix timestamp");
  }
  const acceptanceCriteriaHash = resolveCriteriaHash(flags, fail);
  return {
    poster: ethers.getAddress(from),
    totalAmount,
    deadline,
    acceptanceCriteriaHash,
    chainId: 8453,
    taskRegistry: manifest.taskRegistry,
  };
}

export function serializeTaskPreview(task) {
  return {
    poster: task.poster,
    totalAmountAzlWei: task.totalAmount.toString(),
    deadline: task.deadline,
    acceptanceCriteriaHash: task.acceptanceCriteriaHash,
    chainId: task.chainId,
    taskRegistry: task.taskRegistry,
  };
}
