import { ethers } from "ethers";
import type { TaskTerms } from "./types.js";

/** Canonical V2 offchain settlement digest bound to immutable task terms. */
export function buildSettlementDigest(terms: TaskTerms): string {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    [
      "bytes32",
      "uint256",
      "address",
      "address",
      "address",
      "uint256",
      "uint8",
      "bytes32",
      "uint256",
      "uint256",
      "uint256",
      "bytes32",
    ],
    [
      ethers.id("azzle-task-settlement-v2"),
      terms.chainId,
      terms.registryAddress,
      terms.poster,
      terms.worker,
      terms.token ?? ethers.ZeroAddress,
      terms.totalAmount,
      terms.escrowMode ?? 0,
      ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint256[]"],
          [terms.milestoneAmounts ?? []]
        )
      ),
      terms.streamRate ?? 0n,
      terms.hourBlockSize ?? 0n,
      terms.deadline,
      terms.acceptanceCriteriaHash,
    ]
  );
  return ethers.keccak256(encoded);
}
