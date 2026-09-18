import type {
  PolicyQuote,
  SubmitInput,
  TransactionKit,
} from "@genlayer/transaction-kit";
import {
  GenLayerClient,
  type TransactionLifecycle,
  type TransactionHash,
} from "./genlayer-client";
import { createStudioNextClient } from "./genlayer-transport";
import {
  LocalStoragePendingTransactionStore,
  TransactionCoordinator,
  type PendingTransaction,
  type PendingTransactionStore,
} from "./transaction-lifecycle";

export interface ActiveTransactionMetadata {
  network: string;
  chainId: number;
  action: string;
  context: string;
}

export interface ActiveTransactionRunnerOptions<T> extends ActiveTransactionMetadata {
  operationId: string;
  kit: TransactionKit | null;
  quote: PolicyQuote | null;
  transaction: SubmitInput;
  preconditionRead: () => Promise<void>;
  readFinalState: () => Promise<T>;
  maxAttempts?: number;
  pollIntervalMs?: number;
  onHash?: (pending: PendingTransaction) => void;
  onLifecycle?: (lifecycle: TransactionLifecycle) => void;
}

export interface ActiveTransactionRunnerDependencies {
  store: PendingTransactionStore;
  client: Pick<GenLayerClient, "reconcile">;
}

/**
 * The only active write orchestration seam. Fee estimation stays in the
 * transaction kit; every submission and recovery path is coordinated here.
 */
export class ActiveTransactionRunner<T> {
  private readonly coordinator: TransactionCoordinator;

  public constructor(
    private readonly options: ActiveTransactionRunnerOptions<T>,
    private readonly dependencies: ActiveTransactionRunnerDependencies,
  ) {
    this.coordinator = new TransactionCoordinator(dependencies.client, dependencies.store);
  }

  public pending(): PendingTransaction | null {
    return this.dependencies.store.get(this.options.operationId);
  }

  public execute(): Promise<T> {
    return this.coordinator.execute({
      operationId: this.options.operationId,
      preconditionRead: this.options.preconditionRead,
      broadcastOnce: async (): Promise<TransactionHash> => {
        if (this.pending()) {
          throw new Error("A transaction hash is already persisted; reconcile it instead of broadcasting.");
        }
        if (!this.options.kit || !this.options.quote) {
          throw new Error("A verified fee quote is required before the first broadcast.");
        }
        const submitted = await this.options.kit.submit(this.options.quote, this.options.transaction);
        return submitted.genlayerTxId;
      },
      readFinalState: this.options.readFinalState,
      pendingMetadata: {
        network: this.options.network,
        chainId: this.options.chainId,
        action: this.options.action,
        context: this.options.context,
      },
      onHash: this.options.onHash,
      maxAttempts: this.options.maxAttempts,
      pollIntervalMs: this.options.pollIntervalMs,
      onLifecycle: this.options.onLifecycle,
    });
  }
}

export function createActiveTransactionRunner<T>(
  options: ActiveTransactionRunnerOptions<T>,
  dependencies?: Partial<ActiveTransactionRunnerDependencies>,
): ActiveTransactionRunner<T> {
  const store = dependencies?.store ?? new LocalStoragePendingTransactionStore();
  const client = dependencies?.client ?? new GenLayerClient(createStudioNextClient());
  return new ActiveTransactionRunner(options, { store, client });
}

export async function estimateActiveTransaction(
  kit: TransactionKit,
  transaction: SubmitInput,
): Promise<PolicyQuote> {
  return kit.estimate({ preset: "standard", userValue: 0n }, transaction);
}
