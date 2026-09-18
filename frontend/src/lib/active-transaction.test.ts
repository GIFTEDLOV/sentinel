import { describe, expect, it } from "vitest";
import type { PolicyQuote, SubmitInput, TransactionKit } from "@genlayer/transaction-kit";
import type { GenLayerClient, TransactionLifecycle } from "./genlayer-client";
import { createActiveTransactionRunner, estimateActiveTransaction, type ActiveTransactionRunnerOptions } from "./active-transaction";
import {
  LocalStoragePendingTransactionStore,
  MemoryPendingTransactionStore,
  TransactionFailedError,
  TransactionPendingError,
} from "./transaction-lifecycle";

const transaction: SubmitInput = {
  kind: "write",
  address: "0xd83b20eccf5c1ddd70ad57ef0e25a5200079c4de",
  method: "open_incident",
  args: ["incident-test", "sentinel-demo"],
};

const quote = { verification: { status: "verified" } } as unknown as PolicyQuote;

function clientFor(sequence: TransactionLifecycle[], hashes: string[] = []): Pick<GenLayerClient, "reconcile"> {
  return {
    reconcile: async (hash) => {
      hashes.push(hash);
      return sequence.shift() ?? sequence[sequence.length - 1];
    },
  };
}

function options<T>(overrides: Partial<ActiveTransactionRunnerOptions<T>> = {}): ActiveTransactionRunnerOptions<T> {
  return {
    operationId: "studio-next:61997:open_incident:incident-test",
    network: "GenLayer Studio Next",
    chainId: 61997,
    action: "open_incident",
    context: "0xd83b20eccf5c1ddd70ad57ef0e25a5200079c4de|open_incident|incident-test|sentinel-demo",
    kit: null,
    quote: null,
    transaction,
    preconditionRead: async () => undefined,
    readFinalState: async () => "VERIFIED" as T,
    maxAttempts: 1,
    pollIntervalMs: 0,
    ...overrides,
  };
}

function submittingKit(hash: `0x${string}`, onSubmit?: () => void): TransactionKit {
  return {
    submit: async () => {
      onSubmit?.();
      return { genlayerTxId: hash };
    },
  } as unknown as TransactionKit;
}

describe("active transaction orchestration", () => {
  it("persists the returned hash before the active UI callback and reconciliation", async () => {
    const store = new MemoryPendingTransactionStore();
    const events: string[] = [];
    const runner = createActiveTransactionRunner(options({
      kit: submittingKit("0xordered"),
      quote,
      onHash: (pending) => {
        events.push(store.get(pending.operationId)?.hash === pending.hash ? "persisted" : "missing");
      },
    }), {
      store,
      client: {
        reconcile: async (hash) => {
          events.push(`reconcile:${hash}`);
          return { hash, status: "FINALIZED", executionSucceeded: true };
        },
      },
    });

    await expect(runner.execute()).resolves.toBe("VERIFIED");
    expect(events).toEqual(["persisted", "reconcile:0xordered"]);
  });

  it("broadcasts exactly once, persists immediately, and resumes the same hash", async () => {
    const store = new MemoryPendingTransactionStore();
    const hashes: string[] = [];
    let broadcasts = 0;
    const first = createActiveTransactionRunner(options({
      kit: submittingKit("0xabc", () => { broadcasts += 1; }),
      quote,
    }), { store, client: clientFor([{ hash: "0xabc", status: "PENDING", executionSucceeded: null }], hashes) });

    await expect(first.execute()).rejects.toBeInstanceOf(TransactionPendingError);
    expect(broadcasts).toBe(1);
    expect(store.get("studio-next:61997:open_incident:incident-test")).toMatchObject({ hash: "0xabc", network: "GenLayer Studio Next", chainId: 61997, action: "open_incident" });

    const resumed = createActiveTransactionRunner(options({
      kit: null,
      quote: null,
      readFinalState: async () => "VERIFIED",
    }), { store, client: clientFor([{ hash: "0xabc", status: "FINALIZED", executionSucceeded: true }], hashes) });
    await expect(resumed.execute()).resolves.toBe("VERIFIED");
    expect(broadcasts).toBe(1);
    expect(hashes).toEqual(["0xabc", "0xabc"]);
    expect(store.get("studio-next:61997:open_incident:incident-test")).toBeNull();
  });

  it("does not broadcast again when tracking times out and the same runner is resumed", async () => {
    const store = new MemoryPendingTransactionStore();
    let broadcasts = 0;
    let reconciliations = 0;
    const runner = createActiveTransactionRunner(options({
      kit: submittingKit("0xtimeout", () => { broadcasts += 1; }),
      quote,
      maxAttempts: 1,
    }), {
      store,
      client: {
        reconcile: async (hash) => {
          reconciliations += 1;
          return reconciliations === 1
            ? { hash, status: "PENDING", executionSucceeded: null }
            : { hash, status: "FINALIZED", executionSucceeded: true };
        },
      },
    });

    await expect(runner.execute()).rejects.toBeInstanceOf(TransactionPendingError);
    await expect(runner.execute()).resolves.toBe("VERIFIED");
    expect(broadcasts).toBe(1);
    expect(reconciliations).toBe(2);
  });

  it("survives storage and coordinator reconstruction without rebroadcasting", async () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } } as Storage;
    const firstStore = new LocalStoragePendingTransactionStore(storage);
    let broadcasts = 0;
    const first = createActiveTransactionRunner(options({ kit: submittingKit("0xrefresh", () => { broadcasts += 1; }), quote }), { store: firstStore, client: clientFor([{ hash: "0xrefresh", status: "PENDING", executionSucceeded: null }]) });
    await expect(first.execute()).rejects.toBeInstanceOf(TransactionPendingError);

    const restoredStore = new LocalStoragePendingTransactionStore(storage);
    const restored = createActiveTransactionRunner(options({ kit: null, quote: null }), { store: restoredStore, client: clientFor([{ hash: "0xrefresh", status: "FINALIZED", executionSucceeded: true }]) });
    await expect(restored.execute()).resolves.toBe("VERIFIED");
    expect(broadcasts).toBe(1);
    expect(restoredStore.get("studio-next:61997:open_incident:incident-test")).toBeNull();
  });

  it("does not treat finalized failed execution as success", async () => {
    const store = new MemoryPendingTransactionStore();
    let readback = 0;
    const runner = createActiveTransactionRunner(options({ kit: submittingKit("0xfailed"), quote, readFinalState: async () => { readback += 1; return "BAD"; } }), { store, client: clientFor([{ hash: "0xfailed", status: "FINALIZED", executionSucceeded: false }]) });
    await expect(runner.execute()).rejects.toBeInstanceOf(TransactionFailedError);
    expect(readback).toBe(0);
    expect(store.get("studio-next:61997:open_incident:incident-test")).toBeNull();
  });

  it("requires state reread after finalized successful execution", async () => {
    const store = new MemoryPendingTransactionStore();
    let readback = 0;
    const runner = createActiveTransactionRunner(options({ kit: submittingKit("0xsuccess"), quote, readFinalState: async () => { readback += 1; return "STATE VERIFIED"; } }), { store, client: clientFor([{ hash: "0xsuccess", status: "FINALIZED", executionSucceeded: true }]) });
    await expect(runner.execute()).resolves.toBe("STATE VERIFIED");
    expect(readback).toBe(1);
    expect(store.get("studio-next:61997:open_incident:incident-test")).toBeNull();
  });

  it("keeps a successful hash when state reread fails and retries the read only", async () => {
    const store = new MemoryPendingTransactionStore();
    let broadcasts = 0;
    const first = createActiveTransactionRunner(options({ kit: submittingKit("0xreadback", () => { broadcasts += 1; }), quote, readFinalState: async () => { throw new Error("temporary readback failure"); } }), { store, client: clientFor([{ hash: "0xreadback", status: "FINALIZED", executionSucceeded: true }]) });
    await expect(first.execute()).rejects.toThrow("temporary readback failure");
    expect(store.get("studio-next:61997:open_incident:incident-test")?.hash).toBe("0xreadback");

    const retry = createActiveTransactionRunner(options({ kit: null, quote: null, readFinalState: async () => "READ VERIFIED" }), { store, client: clientFor([{ hash: "0xreadback", status: "FINALIZED", executionSucceeded: true }]) });
    await expect(retry.execute()).resolves.toBe("READ VERIFIED");
    expect(broadcasts).toBe(1);
  });

  it("keeps a finalized successful hash after a read error and retries reconciliation without rebroadcasting", async () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } } as Storage;
    const store = new LocalStoragePendingTransactionStore(storage);
    let broadcasts = 0;
    let reads = 0;
    const runner = createActiveTransactionRunner(options({
      kit: submittingKit("0xstate", () => { broadcasts += 1; }),
      quote,
      readFinalState: async () => {
        reads += 1;
        if (reads === 1) throw new Error("read connection lost");
        return "STATE VERIFIED";
      },
    }), {
      store,
      client: clientFor([{ hash: "0xstate", status: "FINALIZED", executionSucceeded: true }, { hash: "0xstate", status: "FINALIZED", executionSucceeded: true }]),
    });

    await expect(runner.execute()).rejects.toThrow("read connection lost");
    expect(store.get("studio-next:61997:open_incident:incident-test")?.hash).toBe("0xstate");
    await expect(createActiveTransactionRunner(options({
      kit: null,
      quote: null,
      readFinalState: async () => "STATE VERIFIED",
    }), {
      store: new LocalStoragePendingTransactionStore(storage),
      client: clientFor([{ hash: "0xstate", status: "FINALIZED", executionSucceeded: true }]),
    }).execute()).resolves.toBe("STATE VERIFIED");
    expect(broadcasts).toBe(1);
  });

  it("keeps wallet rejection pre-broadcast and allows safe re-estimation", async () => {
    const store = new MemoryPendingTransactionStore();
    const rejectingKit = { submit: async () => { throw new Error("User rejected the signature"); } } as unknown as TransactionKit;
    const runner = createActiveTransactionRunner(options({ kit: rejectingKit, quote }), { store, client: clientFor([]) });
    await expect(runner.execute()).rejects.toThrow("User rejected");
    expect(store.get("studio-next:61997:open_incident:incident-test")).toBeNull();

    let estimates = 0;
    const estimatingKit = { estimate: async () => { estimates += 1; if (estimates === 1) throw new Error("fee read delayed"); return quote; } } as unknown as TransactionKit;
    await expect(estimateActiveTransaction(estimatingKit, transaction)).rejects.toThrow("fee read delayed");
    await expect(estimateActiveTransaction(estimatingKit, transaction)).resolves.toBe(quote);
    expect(estimates).toBe(2);
  });
});
