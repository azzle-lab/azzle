/**
 * End-to-end autonomous lifecycle without human input (off-chain portions).
 */
import { runPosterAgent } from "./poster-agent.js";
import { runWorkerAgent } from "./worker-agent.js";
import { runVerifierAgent } from "./verifier-agent.js";
import type { TaskTerms } from "../sdk/types.js";
import { loadBaseMainnetV2Manifest } from "../sdk/manifest-v2.js";
import { namespacedTaskId, resolveExpectedMarket } from "../sdk/markets.js";

export async function runLifecycleDemo() {
  if (!process.env.AZZLE_MARKET) throw new Error("Lifecycle demo requires AZZLE_MARKET=standard or micro");
  const manifest = loadBaseMainnetV2Manifest();
  const market = resolveExpectedMarket(process.env.AZZLE_MARKET, manifest);
  const terms: TaskTerms = {
    poster: "0x0000000000000000000000000000000000000001",
    worker: "0x0000000000000000000000000000000000000002",
    totalAmount: 1000000n,
    deadline: Math.floor(Date.now() / 1000) + 86400,
    acceptanceCriteriaHash: "0x" + "00".repeat(32),
    chainId: 8453n,
    registryAddress: manifest.taskRegistry,
  };

  const { digest } = await runPosterAgent(terms, manifest);
  const deliverableHash = "0x" + "ab".repeat(32);
  const receipt = await runWorkerAgent({
    taskId: namespacedTaskId(market, 1),
    worker: terms.worker,
    deliverableHash,
  });
  const verification = await runVerifierAgent(
    receipt,
    { mode: "deterministic" },
    deliverableHash
  );

  console.log("[lifecycle-demo] complete", {
    digest,
    receiptHash: receipt.receiptHash,
    verified: verification.valid,
  });
}

runLifecycleDemo().catch(console.error);
