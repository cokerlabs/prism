import { describe, expect, it } from "vitest";
import {
  cacheTtlSeconds,
  createMemoryCache,
  seriesCacheKey,
} from "../src/clients/cache";
import { defaultObservationStart } from "../src/clients/window";

describe("series cache", () => {
  it("uses longer TTLs for slower frequencies", () => {
    expect(cacheTtlSeconds("daily")).toBeGreaterThanOrEqual(60 * 60);
    expect(cacheTtlSeconds("monthly")).toBeGreaterThanOrEqual(6 * 60 * 60);
    expect(cacheTtlSeconds("quarterly")).toBeGreaterThanOrEqual(12 * 60 * 60);
    expect(cacheTtlSeconds("annual")).toBeGreaterThanOrEqual(12 * 60 * 60);
  });

  it("keys by source, native id, and request params", () => {
    expect(
      seriesCacheKey({
        source: "FRED",
        nativeId: "CPIAUCSL",
        observationStart: "2006-09-12",
        vintagePolicy: "latest",
      }),
    ).toBe("FRED|CPIAUCSL|2006-09-12||latest|");
  });

  it("returns a hit before expiry and misses after TTL", async () => {
    let now = 0;
    const cache = createMemoryCache({ now: () => now });
    await cache.set("FRED|UNRATE", '{"ok":true}', 6 * 60 * 60);
    expect(await cache.get("FRED|UNRATE")).toBe('{"ok":true}');
    now = 6 * 60 * 60 * 1000;
    expect(await cache.get("FRED|UNRATE")).toBeUndefined();
  });

  it("defaults the observation window to twenty years", () => {
    expect(defaultObservationStart(new Date("2026-09-12T00:00:00.000Z"))).toBe(
      "2006-09-12",
    );
  });
});
