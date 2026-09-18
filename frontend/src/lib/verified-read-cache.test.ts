import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  invalidateVerified,
  readSharedVerified,
  readVerified,
  resetVerifiedReadCacheForTests,
  verifiedReadKey,
  writeVerified,
  type VerifiedReadIdentity,
} from "./verified-read-cache";

const identity: VerifiedReadIdentity = {
  chainId: 61997,
  sentinelAddress: "0xSentinel",
  protectedDemoAddress: "0xProtectedDemo",
  protocolId: "sentinel-demo",
  incidentId: "incident-test",
};

function makeStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
    clear: () => { values.clear(); },
    key: (index) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  } as Storage;
}

describe("verified read cache", () => {
  beforeEach(() => {
    resetVerifiedReadCacheForTests();
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: makeStorage() });
  });

  afterEach(() => {
    resetVerifiedReadCacheForTests();
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it("hydrates a verified value from persistent storage after memory reconstruction", () => {
    const key = verifiedReadKey("dashboard");
    writeVerified(key, identity, { state: "RECOVERED" }, 1234);
    resetVerifiedReadCacheForTests();

    expect(readVerified<{ state: string }>(key, identity)).toEqual({
      version: 1,
      data: { state: "RECOVERED" },
      verifiedAt: 1234,
      identity: { ...identity, sentinelAddress: "0xsentinel", protectedDemoAddress: "0xprotecteddemo" },
    });
  });

  it("rejects a cache entry bound to a different chain or address", () => {
    const key = verifiedReadKey("target");
    writeVerified(key, identity, { paused: false });

    expect(readVerified(key, { ...identity, chainId: 1 })).toBeNull();
    expect(readVerified(key, { ...identity, protectedDemoAddress: "0xOther" })).toBeNull();
  });

  it("replaces cached data after a successful background refresh", async () => {
    const key = verifiedReadKey("protocol");
    writeVerified(key, identity, { version: "old" }, 1000);

    const next = await readSharedVerified(key, identity, async () => ({ version: "new" }), { forceFresh: true });

    expect(next.data).toEqual({ version: "new" });
    expect(readVerified(key, identity)?.data).toEqual({ version: "new" });
  });

  it("retains the last verified value when a refresh fails", async () => {
    const key = verifiedReadKey("incident");
    writeVerified(key, identity, { state: "RECOVERED" });

    await expect(readSharedVerified(key, identity, async () => { throw new Error("temporary RPC failure"); }, { forceFresh: true })).rejects.toThrow("temporary RPC failure");
    expect(readVerified(key, identity)?.data).toEqual({ state: "RECOVERED" });
  });

  it("deduplicates concurrent requests for the same resource", async () => {
    const key = verifiedReadKey("target");
    let calls = 0;
    let resolveLoader: ((value: { paused: boolean }) => void) | undefined;
    const loader = () => {
      calls += 1;
      return new Promise<{ paused: boolean }>((resolve) => { resolveLoader = resolve; });
    };

    const first = readSharedVerified(key, identity, loader, { forceFresh: true });
    const second = readSharedVerified(key, identity, loader, { forceFresh: true });
    expect(calls).toBe(1);
    resolveLoader?.({ paused: false });

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it("clears persisted data when a write invalidates a resource", () => {
    const key = verifiedReadKey("dashboard");
    writeVerified(key, identity, { state: "RECOVERED" });
    invalidateVerified(key);

    expect(readVerified(key, identity)).toBeNull();
  });
});
