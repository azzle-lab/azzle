import { Contract, ethers } from "ethers";
import type { OnChainCorrelationEvent, OnChainEventHandler } from "./types.js";
import type { XmtpNegotiationTransport } from "./transport.js";
import { namespacedTaskId, type AzzleMarket } from "../markets.js";

const REGISTRY_EVENTS_ABI = [
  "event TaskPosted(uint256 indexed taskId, address indexed poster, uint256 totalAmount, uint256 amountUsd6, uint64 deadline)",
  "event TaskClaimed(uint256 indexed taskId, address indexed worker)",
  "event TaskFunded(uint256 indexed taskId, uint256 amount)",
  "event TaskActivated(uint256 indexed taskId)",
  "event TaskDelivered(uint256 indexed taskId, uint64 deliveredAt)",
  "event TaskReleased(uint256 indexed taskId, uint256 amount)",
  "event TaskCompleted(uint256 indexed taskId)",
  "event TaskCancelled(uint256 indexed taskId)",
  "event TaskDisputed(uint256 indexed taskId, address indexed opener, bytes32 evidenceHash)",
  "event TaskResolved(uint256 indexed taskId, uint8 resolution, address defaultingParty)",
];

type EventMeta = { blockNumber: number; transactionHash: string };

function eventMeta(args: unknown[]): EventMeta {
  const ev = args[args.length - 1] as { log?: EventMeta };
  return {
    blockNumber: ev.log?.blockNumber ?? 0,
    transactionHash: ev.log?.transactionHash ?? "",
  };
}

export interface ChainEventIndexerConfig {
  rpcUrl: string;
  registryAddress: string;
  market: AzzleMarket;
  transport: XmtpNegotiationTransport;
}

/**
 * Subscribes to on-chain events and correlates them to open XMTP threads
 * via (taskId, negotiationId) — foundation for docs/indexer-schema.md.
 */
export class ChainEventIndexer {
  private handlers = new Set<OnChainEventHandler>();
  private contracts: Contract[] = [];

  constructor(private readonly config: ChainEventIndexerConfig) {}

  subscribe(handler: OnChainEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async start(): Promise<void> {
    const provider = new ethers.JsonRpcProvider(this.config.rpcUrl);
    const registry = new Contract(
      this.config.registryAddress,
      REGISTRY_EVENTS_ABI,
      provider
    );
    this.contracts.push(registry);

    registry.on("TaskPosted", (...args: unknown[]) => {
      const [taskId, poster, totalAmount, amountUsd6, deadline] = args as [
        bigint,
        string,
        bigint,
        bigint,
        bigint,
        unknown,
      ];
      const meta = eventMeta(args);
      void this.emit({
        kind: "TaskPosted",
        taskId: namespacedTaskId(this.config.market, taskId),
        blockNumber: meta.blockNumber,
        txHash: meta.transactionHash,
        data: {
          poster,
          totalAmount: totalAmount.toString(),
          amountUsd6: amountUsd6.toString(),
          deadline: deadline.toString(),
        },
      });
    });

    registry.on("TaskClaimed", (...args: unknown[]) => {
      const [taskId, worker] = args as [bigint, string, unknown];
      const meta = eventMeta(args);
      void this.emit({
        kind: "TaskClaimed",
        taskId: namespacedTaskId(this.config.market, taskId),
        blockNumber: meta.blockNumber,
        txHash: meta.transactionHash,
        data: { worker },
      });
    });

    registry.on("TaskFunded", (...args: unknown[]) => {
      const [taskId, amount] = args as [bigint, bigint, unknown];
      const meta = eventMeta(args);
      void this.emit({
        kind: "TaskFunded",
        taskId: namespacedTaskId(this.config.market, taskId),
        blockNumber: meta.blockNumber,
        txHash: meta.transactionHash,
        data: { amount: amount.toString() },
      });
    });

    registry.on("TaskActivated", (...args: unknown[]) => {
      const [taskId] = args as [bigint, unknown];
      const meta = eventMeta(args);
      void this.emit({
        kind: "TaskActivated",
        taskId: namespacedTaskId(this.config.market, taskId),
        blockNumber: meta.blockNumber,
        txHash: meta.transactionHash,
        data: {},
      });
    });

    registry.on("TaskDelivered", (...args: unknown[]) => {
      const [taskId, deliveredAt] = args as [
        bigint,
        bigint,
        unknown,
      ];
      const meta = eventMeta(args);
      void this.emit({
        kind: "TaskDelivered",
        taskId: namespacedTaskId(this.config.market, taskId),
        blockNumber: meta.blockNumber,
        txHash: meta.transactionHash,
        data: { deliveredAt: deliveredAt.toString() },
      });
    });

    registry.on("TaskReleased", (...args: unknown[]) => {
      const [taskId, amount] = args as [bigint, bigint, unknown];
      const meta = eventMeta(args);
      void this.emit({
        kind: "TaskReleased",
        taskId: namespacedTaskId(this.config.market, taskId),
        blockNumber: meta.blockNumber,
        txHash: meta.transactionHash,
        data: { amount: amount.toString() },
      });
    });

    registry.on("TaskCompleted", (...args: unknown[]) => {
      const [taskId] = args as [bigint, unknown];
      const meta = eventMeta(args);
      void this.emit({
        kind: "TaskCompleted",
        taskId: namespacedTaskId(this.config.market, taskId),
        blockNumber: meta.blockNumber,
        txHash: meta.transactionHash,
        data: {},
      });
    });

    registry.on("TaskCancelled", (...args: unknown[]) => {
      const [taskId] = args as [bigint, unknown];
      const meta = eventMeta(args);
      void this.emit({
        kind: "TaskCancelled",
        taskId: namespacedTaskId(this.config.market, taskId),
        blockNumber: meta.blockNumber,
        txHash: meta.transactionHash,
        data: {},
      });
    });

    registry.on("TaskDisputed", (...args: unknown[]) => {
      const [taskId, opener, evidenceHash] = args as [bigint, string, string, unknown];
      const meta = eventMeta(args);
      void this.emit({
        kind: "TaskDisputed",
        taskId: namespacedTaskId(this.config.market, taskId),
        blockNumber: meta.blockNumber,
        txHash: meta.transactionHash,
        data: { opener, evidenceHash },
      });
    });

    registry.on("TaskResolved", (...args: unknown[]) => {
      const [taskId, resolution, defaultingParty] = args as [bigint, bigint, string, unknown];
      const meta = eventMeta(args);
      void this.emit({
        kind: "TaskResolved",
        taskId: namespacedTaskId(this.config.market, taskId),
        blockNumber: meta.blockNumber,
        txHash: meta.transactionHash,
        data: { resolution: Number(resolution), defaultingParty },
      });
    });
  }

  private async emit(event: OnChainCorrelationEvent): Promise<void> {
    event.negotiationId =
      event.negotiationId ??
      (event.taskId
        ? this.config.transport.resolveNegotiationId(event.taskId)
        : undefined);
    for (const handler of this.handlers) {
      await handler(event);
    }
  }

  stop(): void {
    for (const contract of this.contracts) {
      contract.removeAllListeners();
    }
    this.contracts = [];
  }
}
