/**
 * Reference arbitrator: load evidence → optional agent recommendation →
 * human confirmation → rule() or offchain revision request.
 */
import { AzzleArbitrator } from "../sdk/arbitration/index.js";
import { AzzleV2Client } from "../sdk/client-v2.js";
import { loadMarketManifest, type AzzleMarket } from "../sdk/markets.js";
import type { ethers } from "ethers";

export async function runArbitratorCase(params: {
  market: AzzleMarket;
  rpcUrl: string;
  signer: ethers.Signer;
  taskId: string;
}) {
  const manifest = loadMarketManifest(params.market);
  const client = new AzzleV2Client(manifest, params.rpcUrl, params.market).connect(params.signer);
  const arbitrator = await params.signer.getAddress();
  const agent = new AzzleArbitrator(client, arbitrator, "human-in-the-loop");
  const bundle = await agent.loadCase(params.taskId);
  const suggestion = await agent.suggest(bundle);
  return { bundle, suggestion, preview: agent.preview(suggestion.intent, suggestion.workerBps) };
}
