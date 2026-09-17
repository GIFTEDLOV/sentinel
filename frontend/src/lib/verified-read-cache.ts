export interface VerifiedReadIdentity {
  chainId: number;
  sentinelAddress: string | null;
  protectedDemoAddress: string | null;
  protocolId?: string | null;
  incidentId?: string | null;
}

export interface VerifiedRead<T> {
  data: T;
  verifiedAt: number;
  identity: VerifiedReadIdentity;
}

interface StoredVerifiedRead<T> extends VerifiedRead<T> {
  version: 1;
}

interface ReadOptions {
  forceFresh?: boolean;
}

const VERSION = 1 as const;
const memory = new Map<string, StoredVerifiedRead<unknown>>();
const inflight = new Map<string, Promise<StoredVerifiedRead<unknown>>>();

function storage(): Storage | null {
  if (typeof globalThis === "undefined" || !("localStorage" in globalThis)) return null;
  try {
    const candidate = globalThis.localStorage;
    return candidate && typeof candidate.getItem === "function" ? candidate : null;
  } catch {
    return null;
  }
}

function normalizedIdentity(identity: VerifiedReadIdentity): VerifiedReadIdentity {
  return {
    chainId: identity.chainId,
    sentinelAddress: identity.sentinelAddress?.toLowerCase() ?? null,
    protectedDemoAddress: identity.protectedDemoAddress?.toLowerCase() ?? null,
    protocolId: identity.protocolId ?? null,
    incidentId: identity.incidentId ?? null,
  };
}

function sameIdentity(left: VerifiedReadIdentity, right: VerifiedReadIdentity): boolean {
  return JSON.stringify(normalizedIdentity(left)) === JSON.stringify(normalizedIdentity(right));
}

export function verifiedReadKey(resource: string, qualifier?: string): string {
  return `sentinel:verified:${resource}:v${VERSION}${qualifier ? `:${encodeURIComponent(qualifier)}` : ""}`;
}

export function readVerified<T>(key: string, identity: VerifiedReadIdentity): VerifiedRead<T> | null {
  const expected = normalizedIdentity(identity);
  const cached = memory.get(key) as StoredVerifiedRead<T> | undefined;
  if (cached && cached.version === VERSION && sameIdentity(cached.identity, expected)) return cached;

  const raw = storage()?.getItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredVerifiedRead<T>;
    if (parsed.version !== VERSION || typeof parsed.verifiedAt !== "number" || !sameIdentity(parsed.identity, expected)) return null;
    memory.set(key, parsed as StoredVerifiedRead<unknown>);
    return parsed;
  } catch {
    return null;
  }
}

export function writeVerified<T>(key: string, identity: VerifiedReadIdentity, data: T, verifiedAt = Date.now()): VerifiedRead<T> {
  const record: StoredVerifiedRead<T> = { version: VERSION, data, verifiedAt, identity: normalizedIdentity(identity) };
  memory.set(key, record as StoredVerifiedRead<unknown>);
  try {
    storage()?.setItem(key, JSON.stringify(record));
  } catch {
    // Memory hydration still improves the current session when storage is unavailable.
  }
  return record;
}

export function readSharedVerified<T>(
  key: string,
  identity: VerifiedReadIdentity,
  loader: () => Promise<T>,
  options: ReadOptions = {},
): Promise<VerifiedRead<T>> {
  const active = inflight.get(key) as Promise<StoredVerifiedRead<T>> | undefined;
  if (active) return active;

  if (!options.forceFresh) {
    const cached = readVerified<T>(key, identity);
    if (cached) return Promise.resolve(cached);
  }

  const request = loader()
    .then((data) => writeVerified(key, identity, data))
    .finally(() => { inflight.delete(key); });
  inflight.set(key, request as Promise<StoredVerifiedRead<unknown>>);
  return request;
}

export function invalidateVerified(key: string): void {
  memory.delete(key);
  try {
    storage()?.removeItem(key);
  } catch {
    // Ignore storage cleanup failures.
  }
}

export function resetVerifiedReadCacheForTests(): void {
  memory.clear();
  inflight.clear();
}
