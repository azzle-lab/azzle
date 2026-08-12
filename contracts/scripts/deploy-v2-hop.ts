/**
 * Deploy the stateless AzlHopV2 delegatecall module on Base.
 *
 * Usage:
 *   V2_HOP_ARTIFACT_BASENAME=base-8453-v2-hop.candidate \
 *   npx hardhat run scripts/deploy-v2-hop.ts --network base
 */
import fs from "node:fs";
import path from "node:path";
import { ethers } from "hardhat";
import manifest from "../deployments/base-8453.json";

const OUT_DIR = path.resolve(__dirname, "../deployments");
const BASENAME = process.env.V2_HOP_ARTIFACT_BASENAME?.trim() || "base-8453-v2-hop.candidate";

function assertAddress(name: string, value: string): string {
  if (!ethers.isAddress(value)) throw new Error(`${name} is not a valid address`);
  return ethers.getAddress(value);
}

async function main() {
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== 8453n) throw new Error("AzlHopV2 deployment is Base-only");

  const gateway = assertAddress("paymentGateway", manifest.paymentGateway);
  const azl = assertAddress("azl", manifest.external.azl);
  const weth = assertAddress("weth", manifest.external.weth);
  const router = assertAddress("universalRouter", manifest.external.universalRouter);

  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No deployer signer configured");

  const factory = await ethers.getContractFactory("AzlHopV2");
  const hop = await factory.deploy(gateway);
  await hop.waitForDeployment();
  const address = await hop.getAddress();

  const artifact = {
    version: "1.0.0",
    chainId: "8453",
    name: "AzlHopV2",
    address,
    deployer: deployer.address,
    gateway,
    external: {
      azl,
      weth,
      universalRouter: router,
      permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
      hook: "0xBDF938149ac6a781F94FAa0ed45E6A0e984c6544",
      poolId: "0xaa7a431d1f79ea1f96f4299cce18267b278eb417bd8457b33f3be3c2645254ad",
    },
    sourceManifest: "base-8453.json",
  };
  const output = path.join(OUT_DIR, BASENAME.endsWith(".json") ? BASENAME : `${BASENAME}.json`);
  if (fs.existsSync(output)) throw new Error(`Refusing to overwrite ${output}`);
  fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(artifact, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
