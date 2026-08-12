import { ethers, network } from "hardhat";
import manifest from "../deployments/base-8453.json";

const CHAIN_ID = 8453n;
const APPLY = process.env.ROLL_REFERENCE_APPLY === "1";

const ADAPTER_ABI = [
  "function owner() view returns (address)",
  "function referenceTick() view returns (int24)",
  "function referenceActivatedAt() view returns (uint64)",
  "function pendingReferenceTick() view returns (int24)",
  "function pendingReferenceValidAfter() view returns (uint64)",
  "function isReady() view returns (bool)",
  "function activeLiquidity() view returns (uint128)",
  "function rollReference()",
  "function staticRollReference()",
] as const;

const OBSERVER_ABI = [
  "function consult() view returns (int24)",
  "function observationCount() view returns (uint256)",
  "function latestObservation() view returns (uint64 timestamp, int24 tick, int56 tickCumulative)",
] as const;

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function requireBase(): void {
  if (network.name !== "base") {
    throw new Error(`This script is Base-only; current Hardhat network is "${network.name}".`);
  }
}

async function main(): Promise<void> {
  requireBase();

  const current = await ethers.provider.getNetwork();
  if (current.chainId !== CHAIN_ID) {
    throw new Error(`Expected chainId ${CHAIN_ID}, got ${current.chainId}.`);
  }

  const [signer] = await ethers.getSigners();
  if (!signer) throw new Error("No signer configured. Set the Base deployment signer in contracts/.env.");

  const adapterAddress = ethers.getAddress(manifest.twapAdapter);
  const observerAddress = ethers.getAddress(manifest.observationOracle);
  const adapter = new ethers.Contract(adapterAddress, ADAPTER_ABI, signer);
  const observer = new ethers.Contract(observerAddress, OBSERVER_ABI, signer);

  const [
    owner,
    referenceTick,
    referenceActivatedAt,
    pendingReferenceTick,
    pendingReferenceValidAfter,
    ready,
    activeLiquidity,
    meanTick,
    observationCount,
    latestObservation,
  ] = await Promise.all([
    adapter.owner(),
    adapter.referenceTick(),
    adapter.referenceActivatedAt(),
    adapter.pendingReferenceTick(),
    adapter.pendingReferenceValidAfter(),
    adapter.isReady(),
    adapter.activeLiquidity(),
    observer.consult(),
    observer.observationCount(),
    observer.latestObservation(),
  ]);

  if (!sameAddress(owner, signer.address)) {
    throw new Error(
      `Signer ${signer.address} is not the adapter owner ${owner}. ` +
        "rollReference() is owner-only."
    );
  }

  const report = {
    network: network.name,
    chainId: current.chainId.toString(),
    adapter: adapterAddress,
    observationOracle: observerAddress,
    signer: signer.address,
    owner,
    ready,
    referenceTick: referenceTick.toString(),
    referenceActivatedAt: referenceActivatedAt.toString(),
    pendingReferenceTick: pendingReferenceTick.toString(),
    pendingReferenceValidAfter: pendingReferenceValidAfter.toString(),
    meanTick: meanTick.toString(),
    activeLiquidity: activeLiquidity.toString(),
    observationCount: observationCount.toString(),
    latestObservation: {
      timestamp: latestObservation.timestamp.toString(),
      tick: latestObservation.tick.toString(),
      tickCumulative: latestObservation.tickCumulative.toString(),
    },
    apply: APPLY,
  };

  console.log(JSON.stringify(report, null, 2));

  if (!ready) {
    throw new Error("Adapter is not ready. Check observation freshness, liquidity, and spot/TWAP bounds.");
  }

  // Hardhat/ethers performs the owner and contract safety checks without submitting.
  await adapter.rollReference.staticCall();
  console.log("Static rollReference() call passed.");

  if (!APPLY) {
    console.log("Dry run only. Set ROLL_REFERENCE_APPLY=1 to submit rollReference().");
    return;
  }

  const tx = await adapter.rollReference();
  console.log(`Submitted rollReference(): ${tx.hash}`);
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) throw new Error("rollReference() transaction failed.");

  const [newReferenceTick, newActivatedAt, newReady] = await Promise.all([
    adapter.referenceTick(),
    adapter.referenceActivatedAt(),
    adapter.isReady(),
  ]);

  console.log(
    JSON.stringify(
      {
        transactionHash: tx.hash,
        blockNumber: receipt.blockNumber,
        referenceTick: newReferenceTick.toString(),
        referenceActivatedAt: newActivatedAt.toString(),
        ready: newReady,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
