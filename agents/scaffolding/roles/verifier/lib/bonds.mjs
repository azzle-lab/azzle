import { Contract, ethers } from "ethers";

const REPUTATION_ABI = [
  "function stakeVerifierBond() external payable",
  "function unstakeVerifierBond(uint256 amount) external",
  "function verifierBond(address verifier) external view returns (uint256)",
  "function arbitratorReputation(address arbitrator) external view returns (uint256)",
];

/** Default minimum bond — see arbitration/VERIFIER_SPEC.md */
export const DEFAULT_BOND_WEI = ethers.parseEther("0.5");

export function reputationContract(signerOrProvider, manifest) {
  return new Contract(manifest.reputationRegistry, REPUTATION_ABI, signerOrProvider);
}

export async function stakeVerifierBond(signer, manifest, bondWei = DEFAULT_BOND_WEI) {
  const rep = reputationContract(signer, manifest);
  console.log("[bonds] stakeVerifierBond", ethers.formatEther(bondWei), "ETH");
  const tx = await rep.stakeVerifierBond({ value: bondWei });
  await tx.wait();
}

export async function unstakeVerifierBond(signer, manifest, amountWei) {
  const rep = reputationContract(signer, manifest);
  console.log("[bonds] unstakeVerifierBond", ethers.formatEther(amountWei), "ETH");
  const tx = await rep.unstakeVerifierBond(amountWei);
  await tx.wait();
}

export async function readBond(provider, wallet, manifest) {
  const rep = reputationContract(provider, manifest);
  return await rep.verifierBond(wallet);
}

export async function monitorBondSlashRisk(provider, wallet, manifest, minBondWei = DEFAULT_BOND_WEI / 2n) {
  const bond = await readBond(provider, wallet, manifest);
  const warnings = [];
  if (bond < minBondWei) {
    warnings.push(
      `Verifier bond ${ethers.formatEther(bond)} ETH below ${ethers.formatEther(minBondWei)} ETH — slash risk on bad attestation`
    );
  }
  return { bond, warnings };
}
