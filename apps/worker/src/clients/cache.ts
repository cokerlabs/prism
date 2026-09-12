import type { FetchedSeries } from "./types";

export type SeriesCache = {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
};

export type CacheClock = {
  now: () => number;
};

export function cacheTtlSeconds(frequency: string): number {
  switch (frequency) {
    case "daily":
    case "weekly":
      return 60 * 60;
    case "monthly":
      return 6 * 60 * 60;
    case "quarterly":
    case "annual":
      return 12 * 60 * 60;
    default:
      return 6 * 60 * 60;
  }
}

export function seriesCacheKey(parts: {
  source: string;
  nativeId: string;
  observationStart?: string;
  observationEnd?: string;
  vintagePolicy?: string;
  asOf?: string;
}): string {
  return [
    parts.source,
    parts.nativeId,
    parts.observationStart ?? "",
    parts.observationEnd ?? "",
    parts.vintagePolicy ?? "latest",
    parts.asOf ?? "",
  ].join("|");
}

export function createMemoryCache(clock: CacheClock = { now: () => Date.now() }): SeriesCache {
  const map = new Map<string, { value: string; expiresAt: number }>();
  return {
    async get(key) {
      const row = map.get(key);
      if (!row) {
        return undefined;
      }
      if (clock.now() >= row.expiresAt) {
        map.delete(key);
        return undefined;
      }
      return row.value;
    },
    async set(key, value, ttlSeconds) {
      map.set(key, {
        value,
        expiresAt: clock.now() + ttlSeconds * 1000,
      });
    },
  };
}

export function createKvCache(kv: KVNamespace): SeriesCache {
  return {
    async get(key) {
      return (await kv.get(key)) ?? undefined;
    },
    async set(key, value, ttlSeconds) {
      await kv.put(key, value, {
        expirationTtl: Math.max(60, ttlSeconds),
      });
    },
  };
}

export function serializeFetchedSeries(series: FetchedSeries): string {
  return JSON.stringify(series);
}

export function parseFetchedSeries(raw: string): FetchedSeries {
  return JSON.parse(raw) as FetchedSeries;
}
