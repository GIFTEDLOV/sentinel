import type {
  GenLayerClient,
  TransactionHash,
  TransactionLifecycle,
} from "./genlayer-client";

export interface PendingTransaction {
  operationId: string;
  hash: TransactionHash;
  network?: string;
  chainId?: number;
  action?: string;
  context?: string;
}

export interface PendingTransactionStore {
  get(operationId: string): PendingTransaction | null;
  set(transaction: PendingTransaction): void;
  remove(operationId: string): void;
}

export class MemoryPendingTransactionStore implements PendingTransactionStore {
  private readonly values = new Map<string, PendingTransaction>();

  public get(operationId: string): PendingTransaction | null {
    return this.values.get(operationId) ?? null;
  }

  public set(transaction: PendingTransaction): void {
    this.values.set(transaction.operationId, transaction);
  }

  public remove(operationId: string): void {
    this.values.delete(operationId);
  }
}

export class LocalStoragePendingTransactionStore implements PendingTransactionStore {
  public constructor(private readonly storage: Storage = window.localStorage) {}

  public get(operationId: string): PendingTransaction | null {
    const raw = this.storage.getItem(this.key(operationId));
    if (!raw) return null;
    try {
      const value: unknown = JSON.parse(raw);
      if (typeof value !== "object" || value === null) throw new Error("Invalid pending transaction record.");
      const record = value as Partial<PendingTransaction>;
      if (record.operationId !== operationId || typeof record.hash !== "string" || !record.hash.startsWith("0x")) {
        throw new Error("Invalid pending transaction record.");
      }
      return record as PendingTransaction;
    } catch {
      this.remove(operationId);
      return null;
    }
  }

  public set(transaction: PendingTransaction): void {
    this.storage.setItem(this.key(transaction.operationId), JSON.stringify(transaction));
  }

  public remove(operationId: string): void {
    this.storage.removeItem(this.key(operationId));
  }

  private key(operationId: string): string {
    return `sentinel.pending.${operationId}`;
  }
}

export class TransactionPendingError extends Error {
  public constructor(public readonly hash: TransactionHash) {
    super(`Transaction ${hash} is still pending; the same hash must be reconciled.`);
    this.name = "TransactionPendingError";
  }
}

export class TransactionFailedError extends Error {
  public constructor(public readonly lifecycle: TransactionLifecycle) {
    super(`Transaction ${lifecycle.hash} did not finalize successfully.`);
    this.name = "TransactionFailedError";
  }
}

export class TransactionStateVerificationError extends Error {
  public constructor(
    public readonly hash: TransactionHash,
    public readonly cause: unknown,
  ) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`State verification failed for transaction ${hash}: ${detail}`);
    this.name = "TransactionStateVerificationError";
  }
}

export type TransactionIssueDomain =
  | "WALLET_REJECTED"
  | "BROADCAST_FAILED"
  | "TRANSACTION_PENDING"
  | "CONSENSUS_PENDING"
  | "CONSENSUS_DISAGREEMENT"
  | "EXECUTION_FAILED"
  | "PAUSE_MESSAGE_PENDING"
  | "TARGET_CONFIRMATION_FAILED"
  | "RECOVERY_ASSESSMENT_PENDING"
  | "UNPAUSE_CONFIRMATION_FAILED"
  | "STATE_VERIFICATION_FAILED";

export function classifyTransactionIssue(reason: unknown): TransactionIssueDomain {
  if (reason instanceof TransactionPendingError) return "TRANSACTION_PENDING";
  if (reason instanceof TransactionFailedError) return "EXECUTION_FAILED";
  if (reason instanceof TransactionStateVerificationError) return "STATE_VERIFICATION_FAILED";
  const message = reason instanceof Error ? reason.message.toLowerCase() : String(reason).toLowerCase();
  if (message.includes("wallet") || message.includes("signature") || message.includes("rejected")) return "WALLET_REJECTED";
  if (message.includes("consensus") || message.includes("majority")) return "CONSENSUS_DISAGREEMENT";
  if (message.includes("pause message")) return "PAUSE_MESSAGE_PENDING";
  if (message.includes("unpause")) return "UNPAUSE_CONFIRMATION_FAILED";
  return "BROADCAST_FAILED";
}

export interface TransactionExecution<T> {
  operationId: string;
  preconditionRead: () => Promise<void>;
  broadcastOnce: () => Promise<TransactionHash>;
  readFinalState: () => Promise<T>;
  pendingMetadata?: Omit<PendingTransaction, "operationId" | "hash">;
  onHash?: (pending: PendingTransaction) => void;
  onLifecycle?: (lifecycle: TransactionLifecycle) => void;
  maxAttempts?: number;
  pollIntervalMs?: number;
}

/** Enforces precondition -> broadcast once -> reconcile -> final-state read. */
export class TransactionCoordinator {
  public constructor(
    private readonly client: Pick<GenLayerClient, "reconcile">,
    private readonly store: PendingTransactionStore,
  ) {}

  public async execute<T>(operation: TransactionExecution<T>): Promise<T> {
    const pending = this.store.get(operation.operationId);
    if (pending && operation.pendingMetadata) {
      // Refresh metadata for a recovered active operation without ever
      // replacing its persisted hash.
      this.store.set({ ...pending, ...operation.pendingMetadata });
    }
    const hash = pending?.hash ?? (await this.broadcastAfterPrecondition(operation));
    const lifecycle = await this.waitForFinality(hash, operation);
    if (lifecycle.status !== "FINALIZED" || lifecycle.executionSucceeded !== true) {
      this.store.remove(operation.operationId);
      throw new TransactionFailedError(lifecycle);
    }
    let finalState: T;
    try {
      finalState = await operation.readFinalState();
    } catch (reason: unknown) {
      // Keep the hash pending. A read failure is recoverable, but rebroadcast
      // is never a valid way to repair a missing readback.
      throw new TransactionStateVerificationError(hash, reason);
    }
    this.store.remove(operation.operationId);
    return finalState;
  }

  private async broadcastAfterPrecondition<T>(
    operation: TransactionExecution<T>,
  ): Promise<TransactionHash> {
    await operation.preconditionRead();
    const hash = await operation.broadcastOnce();
    const pending = { operationId: operation.operationId, hash, ...operation.pendingMetadata };
    // This is the single persistence boundary after broadcast and before any
    // long-running reconciliation begins.
    this.store.set(pending);
    operation.onHash?.(pending);
    return hash;
  }

  private async waitForFinality<T>(
    hash: TransactionHash,
    operation: TransactionExecution<T>,
  ): Promise<TransactionLifecycle> {
    const maxAttempts = operation.maxAttempts ?? 20;
    const pollIntervalMs = operation.pollIntervalMs ?? 3_000;
    let lastKnown: TransactionLifecycle = {
      hash,
      status: "PENDING",
      executionSucceeded: null,
    };
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      let lifecycle: TransactionLifecycle;
      try {
        const reconciled = await this.client.reconcile(hash);
        // The requested hash is authoritative for this operation. Keep UI and
        // persistence tied to it even if an adapter returns an incomplete or
        // mismatched hash field.
        lifecycle = reconciled.hash === hash ? reconciled : { ...reconciled, hash };
        lastKnown = lifecycle;
      } catch {
        // A temporary RPC/indexer miss is not permission to rebroadcast. Keep
        // the hash persisted and continue reconciling the same transaction.
        lifecycle = lastKnown;
      }
      operation.onLifecycle?.(lifecycle);
      if (lifecycle.status === "FINALIZED" || lifecycle.status === "FAILED") {
        return lifecycle;
      }
      if (attempt + 1 < maxAttempts && pollIntervalMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
    }
    throw new TransactionPendingError(hash);
  }
}
