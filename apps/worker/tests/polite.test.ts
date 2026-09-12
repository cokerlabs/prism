import { describe, expect, it } from "vitest";
import { DataSourceUnavailableError } from "../src/clients/errors";
import {
  HOST_POLICY,
  PRISM_USER_AGENT,
  RateGate,
  backoffMs,
  createFakeClock,
  parseRetryAfter,
  politeFetch,
} from "../src/clients/polite";

describe("polite HTTP", () => {
  it("identifies Prism and spaces FRED calls by 500ms", async () => {
    const clock = createFakeClock();
    const gate = new RateGate(clock);
    const agents: string[] = [];
    const fetchImpl = (async (_input, init) => {
      const headers = new Headers(init?.headers);
      agents.push(headers.get("User-Agent") ?? "");
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    await politeFetch(
      "https://api.stlouisfed.org/fred/series/observations",
      undefined,
      { fetch: fetchImpl, clock, gate, source: "FRED" },
    );
    await politeFetch(
      "https://api.stlouisfed.org/fred/series/observations",
      undefined,
      { fetch: fetchImpl, clock, gate, source: "FRED" },
    );

    expect(agents).toEqual([PRISM_USER_AGENT, PRISM_USER_AGENT]);
    expect(clock.sleeps).toEqual([HOST_POLICY["api.stlouisfed.org"]?.minIntervalMs]);
  });

  it("keeps BLS under five requests per ten seconds", async () => {
    const clock = createFakeClock();
    const gate = new RateGate(clock);
    const fetchImpl = (async () => new Response("{}", { status: 200 })) as typeof fetch;

    for (let index = 0; index < 6; index += 1) {
      await politeFetch("https://api.bls.gov/publicAPI/v2/timeseries/data/", undefined, {
        fetch: fetchImpl,
        clock,
        gate,
        source: "BLS",
      });
    }

    expect(clock.sleeps.length).toBeGreaterThanOrEqual(5);
    expect(clock.sleeps.every((ms) => ms >= 2000)).toBe(true);
  });

  it("honors Retry-After on 429 and does not hot-loop", async () => {
    const clock = createFakeClock(1_000);
    const gate = new RateGate(clock);
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("slow down", {
          status: 429,
          headers: { "Retry-After": "2" },
        });
      }
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    const response = await politeFetch(
      "https://api.census.gov/data/2023/acs/acs1",
      undefined,
      { fetch: fetchImpl, clock, gate, source: "Census", random: () => 0 },
    );

    expect(response.status).toBe(200);
    expect(calls).toBe(2);
    expect(clock.sleeps).toContain(2000);
  });

  it("uses exponential backoff with jitter when Retry-After is missing", async () => {
    const clock = createFakeClock();
    const gate = new RateGate(clock);
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls < 3) {
        return new Response("slow down", { status: 429 });
      }
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    await politeFetch("https://api.stlouisfed.org/fred/series/observations", undefined, {
      fetch: fetchImpl,
      clock,
      gate,
      source: "FRED",
      random: () => 0.4,
    });

    expect(calls).toBe(3);
    expect(clock.sleeps).toEqual(
      expect.arrayContaining([
        backoffMs(0, () => 0.4),
        backoffMs(1, () => 0.4),
      ]),
    );
  });

  it("stops after capped 429 retries", async () => {
    const clock = createFakeClock();
    const gate = new RateGate(clock);
    const fetchImpl = (async () =>
      new Response("slow down", { status: 429 })) as typeof fetch;

    await expect(
      politeFetch("https://api.stlouisfed.org/fred/series/observations", undefined, {
        fetch: fetchImpl,
        clock,
        gate,
        source: "FRED",
        maxRetries: 2,
        random: () => 0,
      }),
    ).rejects.toBeInstanceOf(DataSourceUnavailableError);
  });

  it("parses Retry-After as an HTTP date", () => {
    expect(parseRetryAfter("Thu, 01 Jan 1970 00:00:03 GMT", 1000)).toBe(2000);
  });
});
