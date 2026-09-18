import { describe, expect, it } from "vitest";
import type { GenLayerClient, TransactionLifecycle } from "./genlayer-client";
import {
  LocalStoragePendingTransactionStore,
  MemoryPendingTransactionStore,
  TransactionCoordinator,
  TransactionFailedError,
  TransactionPendingError,
  TransactionStateVerificationError,
  classifyTransactionIssue,
} from "./transaction-lifecycle";

function clientFor(sequence: TransactionLifecycle[]): Pick<GenLayerClient, "reconcile"> {
  return {
    reconcile: async () => sequence.shift() ?? sequence[sequence.length - 1],
  };
}

describe("TransactionCoordinator", () => {
  it("persists a hash and reconciles the same hash after a timeout", async () => {
    const store = new MemoryPendingTransactionStore();
    const client = clientFor([
      { hash: "0xabc", status: "PENDING", executionSucceeded: null },
    ]);
    const coordinator = new TransactionCoordinator(client, store);
    let broadcasts = 0;

    await expect(
      coordinator.execute({
        operationId: "pause:incident-1",
        preconditionRead: async () => undefined,
        broadcastOnce: async () => {
          broadcasts += 1;
          return "0xabc";
        },
        readFinalState: async () => "PAUSED",
        maxAttempts: 1,
        pollIntervalMs: 0,
      }),
    ).rejects.toBeInstanceOf(TransactionPendingError);

    expect(broadcasts).toBe(1);
    expect(store.get("pause:incident-1")?.hash).toBe("0xabc");

    const finalizedClient = clientFor([
      { hash: "0xabc", status: "FINALIZED", executionSucceeded: true },
    ]);
    const resumed = new TransactionCoordinator(finalizedClient, store);
    const result = await resumed.execute({
      operationId: "pause:incident-1",
      preconditionRead: async () => undefined,
      broadcastOnce: async () => {
        throw new Error("must not rebroadcast");
      },
      readFinalState: async () => "PAUSED",
      maxAttempts: 1,
      pollIntervalMs: 0,
    });

    expect(result).toBe("PAUSED");
    expect(store.get("pause:incident-1")).toBeNull();
  });

  it("does not treat accepted as successful final execution", async () => {
    const store = new MemoryPendingTransactionStore();
    const coordinator = new TransactionCoordinator(
      clientFor([{ hash: "0xdef", status: "ACCEPTED", executionSucceeded: null }]),
      store,
    );

    await expect(
      coordinator.execute({
        operationId: "pause:incident-2",
        preconditionRead: async () => undefined,
        broadcastOnce: async () => "0xdef",
        readFinalState: async () => "PAUSED",
        maxAttempts: 1,
        pollIntervalMs: 0,
      }),
    ).rejects.toBeInstanceOf(TransactionPendingError);
    expect(store.get("pause:incident-2")?.hash).toBe("0xdef");
  });

  it("keeps the hash when a lifecycle lookup temporarily fails", async () => {
    const store = new MemoryPendingTransactionStore();
    let calls = 0;
    const coordinator = new TransactionCoordinator({
      reconcile: async () => {
        calls += 1;
        if (calls === 1) throw new Error("temporary RPC timeout");
        return { hash: "0xrpc", status: "FINALIZED", executionSucceeded: true };
      },
    }, store);

    const result = await coordinator.execute({
      operationId: "rpc-retry",
      preconditionRead: async () => undefined,
      broadcastOnce: async () => "0xrpc",
      readFinalState: async () => "CONFIRMED",
      maxAttempts: 2,
      pollIntervalMs: 0,
    });

    expect(result).toBe("CONFIRMED");
    expect(calls).toBe(2);
    expect(store.get("rpc-retry")).toBeNull();
  });

  it("rejects a finalized transaction whose contract execution failed", async () => {
    const store = new MemoryPendingTransactionStore();
    const coordinator = new TransactionCoordinator(
      clientFor([{ hash: "0xerr", status: "FINALIZED", executionSucceeded: false }]),
      store,
    );

    await expect(
      coordinator.execute({
        operationId: "assessment:incident-3",
        preconditionRead: async () => undefined,
        broadcastOnce: async () => "0xerr",
        readFinalState: async () => "ACTIVE_INCIDENT",
        maxAttempts: 1,
        pollIntervalMs: 0,
      }),
    ).rejects.toBeInstanceOf(TransactionFailedError);
    expect(store.get("assessment:incident-3")).toBeNull();
  });

  it("keeps the pending record when finality succeeded but state verification failed", async () => {
    const store = new MemoryPendingTransactionStore();
    const coordinator = new TransactionCoordinator(
      clientFor([{ hash: "0xread", status: "FINALIZED", executionSucceeded: true }]),
      store,
    );

    await expect(coordinator.execute({
      operationId: "readback:incident-4",
      preconditionRead: async () => undefined,
      broadcastOnce: async () => "0xread",
      readFinalState: async () => { throw new Error("readback unavailable"); },
      maxAttempts: 1,
      pollIntervalMs: 0,
    })).rejects.toBeInstanceOf(TransactionStateVerificationError);
    expect(store.get("readback:incident-4")?.hash).toBe("0xread");
    expect(classifyTransactionIssue(new TransactionStateVerificationError("0xread", new Error("readback unavailable")))).toBe("STATE_VERIFICATION_FAILED");
  });

  it("persists pending hashes across store instances", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    } as Storage;
    const first = new LocalStoragePendingTransactionStore(storage);
    first.set({ operationId: "bind:evidence-1", hash: "0xpersisted" });
    const resumed = new LocalStoragePendingTransactionStore(storage);
    expect(resumed.get("bind:evidence-1")?.hash).toBe("0xpersisted");
    resumed.remove("bind:evidence-1");
    expect(first.get("bind:evidence-1")).toBeNull();
  });

  it("keeps wallet and consensus error domains distinct", () => {
    expect(classifyTransactionIssue(new Error("Wallet rejected the signature"))).toBe("WALLET_REJECTED");
    expect(classifyTransactionIssue(new Error("Consensus disagreement"))).toBe("CONSENSUS_DISAGREEMENT");
  });
});
