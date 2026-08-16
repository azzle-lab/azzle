/**
 * Receipt validation stub — hook into arbitration/VERIFIER_SPEC.md adapter interface.
 * Extend evaluateReceipt() with deterministic / semi-deterministic / subjective adapters.
 */

export function verifyDeterministic(receipt, expectedOutputHash) {
  const output = receipt.artifacts?.find((a) => a.type === "deterministic_output");
  if (!output) return { valid: false, confidence: 0, checks: [] };
  const valid = output.hash.toLowerCase() === expectedOutputHash.toLowerCase();
  return {
    valid,
    confidence: valid ? 1 : 0,
    checks: valid ? ["hash_match"] : ["hash_mismatch"],
  };
}

/**
 * Evaluate off-chain delivery evidence for a V2 dispute or policy workflow.
 * V2 does not expose an on-chain proof-submission or milestone-verification method.
 */
export async function evaluateReceipt(delivery, criteria, expectedOutputHash) {
  if (criteria.mode === "deterministic") {
    return verifyDeterministic(delivery, expectedOutputHash);
  }
  throw new Error(`Verifier mode ${criteria.mode} not implemented — see VERIFIER_SPEC.md`);
}

export function attestationMetadata(result) {
  return {
    confidence: result.confidence,
    checks: result.checks ?? [],
    verifierVersion: "1.0.0",
  };
}
