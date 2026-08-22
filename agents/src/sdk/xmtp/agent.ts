import { ethers } from "ethers";
import type { AzzleV2Client } from "../client-v2.js";
import type { TaskTerms } from "../types.js";
import { linkIdentity } from "./identity.js";
import { NegotiationHandlers, type AgentRole } from "./handlers.js";
import { ChainEventIndexer } from "./correlation.js";
import {
  createNegotiationTransport,
  type XmtpNegotiationTransport,
  type XmtpTransportOptions,
} from "./transport.js";

export interface AgentStartupConfig {
  evmSigner: ethers.Signer;
  azzle: AzzleV2Client;
  role: AgentRole;
  terms: TaskTerms;
  counterpartyEvm: string;
  rpcUrl: string;
  registryAddress: string;
  transportOptions?: Omit<XmtpTransportOptions, "market">;
}

export interface StartedAgent {
  transport: XmtpNegotiationTransport;
  handlers: NegotiationHandlers;
  indexer: ChainEventIndexer;
}

/** Create XMTP client, link identity, wire handlers and on-chain event correlation. */
export async function startAgent(config: AgentStartupConfig): Promise<StartedAgent> {
  if (config.registryAddress.toLowerCase() !== config.azzle.manifest.taskRegistry.toLowerCase()) {
    throw new Error("XMTP registryAddress must match the selected AzzleV2Client manifest");
  }
  const transport = await createNegotiationTransport(config.evmSigner, {
    ...config.transportOptions,
    counterpartyEvm: config.counterpartyEvm,
    market: config.azzle.market,
  });

  await linkIdentity(config.evmSigner, transport.xmtpClient, async (link) => {
    await transport.publishIdentityLink(link, config.counterpartyEvm);
  });

  await transport.connectCounterparty(config.counterpartyEvm);

  const network = await config.evmSigner.provider?.getNetwork();
  const chainId = network?.chainId ?? BigInt(config.azzle.manifest.chainId);
  if (chainId !== BigInt(config.azzle.manifest.chainId)) {
    throw new Error("XMTP signer network must match the selected AzzleV2Client manifest");
  }

  const handlers = new NegotiationHandlers({
    transport,
    azzle: config.azzle,
    evmSigner: config.evmSigner,
    role: config.role,
    terms: config.terms,
    chainId,
    counterpartyEvm: config.counterpartyEvm,
  });

  transport.subscribe((envelope) => handlers.handle(envelope));

  const indexer = new ChainEventIndexer({
    rpcUrl: config.rpcUrl,
    registryAddress: config.registryAddress,
    market: config.azzle.market,
    transport,
  });
  await indexer.start();

  return { transport, handlers, indexer };
}
