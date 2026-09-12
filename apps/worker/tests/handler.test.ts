import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createMemoryCache } from "../src/clients/cache";
import type { FredObservationsPayload } from "../src/clients/fred";
import { PRISM_USER_AGENT, createFakeClock } from "../src/clients/polite";
import { handleRequest, type Env } from "../src/index";

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/series",
);

const cpiaucsl = JSON.parse(
  readFileSync(join(fixturesDir, "CPIAUCSL.json"), "utf8"),
) as FredObservationsPayload;

function envWithAssets(
  handler: (request: Request) => Response | Promise<Response>,
  keys: Partial<Env> = {},
): Env {
  return {
    DB: {} as Env["DB"],
    ASSETS: {
      fetch: handler,
    } as Env["ASSETS"],
    ...keys,
  };
}

function fixtureFredFetch(calls?: Array<{ start?: string; agent?: string }>): typeof fetch {
  return (async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const headers = new Headers(init?.headers);
    calls?.push({
      start: url.searchParams.get("observation_start") ?? undefined,
      agent: headers.get("User-Agent") ?? undefined,
    });
    if (
      url.hostname === "api.stlouisfed.org" &&
      url.searchParams.get("series_id") === "CPIAUCSL"
    ) {
      return new Response(JSON.stringify(cpiaucsl), {
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("missing", { status: 404 });
  }) as typeof fetch;
}

describe("worker routing", () => {
  it("returns health under /in/prism/api/health", async () => {
    const response = await handleRequest(
      new Request("https://cokerlabs.dev/in/prism/api/health"),
      envWithAssets(() => new Response("unused")),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, service: "prism" });
  });

  it("lists curated catalog concepts", async () => {
    const response = await handleRequest(
      new Request("https://cokerlabs.dev/in/prism/api/catalog"),
      envWithAssets(() => new Response("unused")),
    );
    const body = (await response.json()) as {
      version: string;
      concepts: Array<{ seriesId: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.version).toBe("0.1.0");
    expect(body.concepts.map((concept) => concept.seriesId)).toContain(
      "CPIAUCSL",
    );
    expect(body.concepts.map((concept) => concept.seriesId)).toContain(
      "B19013_001E",
    );
  });

  it("does not fetch ACS or BLS concepts", async () => {
    let fetched = false;
    const response = await handleRequest(
      new Request(
        "https://cokerlabs.dev/in/prism/api/series/acs-median-hh-income",
      ),
      envWithAssets(() => new Response("unused"), { FRED_API_KEY: "test-key" }),
      {
        fetch: (async () => {
          fetched = true;
          return new Response("no", { status: 500 });
        }) as typeof fetch,
        now: () => new Date("2026-09-12T00:00:00.000Z"),
        clock: createFakeClock(),
        cache: createMemoryCache(),
      },
    );

    expect(fetched).toBe(false);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "data_source_unavailable",
      service: "prism",
      message: "Data source unavailable",
    });
  });

  it("returns Data source unavailable when the FRED key is missing", async () => {
    const response = await handleRequest(
      new Request("https://cokerlabs.dev/in/prism/api/series/cpi-u-all-items"),
      envWithAssets(() => new Response("unused")),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "data_source_unavailable",
      service: "prism",
      message: "Data source unavailable",
    });
  });

  it("echoes provenance for a fixture-backed FRED series", async () => {
    const calls: Array<{ start?: string; agent?: string }> = [];
    const response = await handleRequest(
      new Request(
        "https://cokerlabs.dev/in/prism/api/series/CPIAUCSL?transform=pc1",
      ),
      envWithAssets(() => new Response("unused"), { FRED_API_KEY: "test-key" }),
      {
        fetch: fixtureFredFetch(calls),
        now: () => new Date("2026-09-12T00:00:00.000Z"),
        clock: createFakeClock(),
        observationSource: "recorded",
        cache: createMemoryCache(),
      },
    );
    const body = (await response.json()) as {
      conceptId: string;
      nativeId: string;
      observations: Array<{ date: string; value: number | null }>;
      provenance: {
        seasonalAdjustment: string;
        priceBasis: string;
        transform: string;
        observationSource: string;
        observationStart?: string;
        requested: { transform: string; conceptId: string };
        sourceUrl: string;
        notes: string;
      };
    };

    expect(response.status).toBe(200);
    expect(body.conceptId).toBe("cpi-u-all-items");
    expect(body.nativeId).toBe("CPIAUCSL");
    expect(body.provenance.seasonalAdjustment).toBe("SA");
    expect(body.provenance.priceBasis).toBe("index");
    expect(body.provenance.transform).toBe("pc1");
    expect(body.provenance.observationSource).toBe("recorded");
    expect(body.provenance.requested).toEqual(
      expect.objectContaining({
        conceptId: "CPIAUCSL",
        transform: "pc1",
      }),
    );
    expect(body.provenance.sourceUrl).toBe(
      "https://fred.stlouisfed.org/series/CPIAUCSL",
    );
    expect(body.provenance.notes).toContain("CPIAUCNS");
    const latest = body.observations.at(-1);
    expect(latest?.date).toBe("2026-08-01");
    expect(latest?.value).not.toBeNull();
    expect(body.provenance.observationStart).toBe("2023-01-01");
    expect(calls[0]?.start).toBe("2006-09-12");
    expect(calls[0]?.agent).toBe(PRISM_USER_AGENT);
  });

  it("prefers a cache hit over a second live call", async () => {
    const calls: Array<{ start?: string; agent?: string }> = [];
    const cache = createMemoryCache();
    const clock = createFakeClock();
    const runtime = {
      fetch: fixtureFredFetch(calls),
      now: () => new Date("2026-09-12T00:00:00.000Z"),
      clock,
      cache,
    };
    const env = envWithAssets(() => new Response("unused"), {
      FRED_API_KEY: "test-key",
    });
    const request = new Request(
      "https://cokerlabs.dev/in/prism/api/series/cpi-u-all-items",
    );

    const first = await handleRequest(request, env, runtime);
    const second = await handleRequest(request, env, runtime);
    const body = (await second.json()) as {
      provenance: { observationSource: string };
    };

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(body.provenance.observationSource).toBe("cached");
  });

  it("returns structured clarify choices instead of remapping SA/NSA", async () => {
    const response = await handleRequest(
      new Request(
        "https://cokerlabs.dev/in/prism/api/series/cpi-u-all-items?seasonal_adjustment=NSA",
      ),
      envWithAssets(() => new Response("unused"), { FRED_API_KEY: "test-key" }),
    );
    const body = (await response.json()) as {
      error: string;
      reason: string;
      choices: Array<{ seriesId: string }>;
    };

    expect(response.status).toBe(409);
    expect(body.error).toBe("clarify");
    expect(body.reason).toBe("seasonal_adjustment_mismatch");
    expect(body.choices.map((choice) => choice.seriesId)).toEqual([
      "CPIAUCSL",
      "CPIAUCNS",
    ]);
  });

  it("does not serve a public root page", async () => {
    const response = await handleRequest(
      new Request("https://cokerlabs.dev/"),
      envWithAssets(() => new Response("<html>app</html>")),
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toContain("/in/prism/");
  });

  it("falls back to the /in/prism/ shell for unknown app paths", async () => {
    const response = await handleRequest(
      new Request("https://cokerlabs.dev/in/prism/compose"),
      envWithAssets((request) => {
        const path = new URL(request.url).pathname;
        if (path === "/in/prism/index.html") {
          return new Response("<html>prism</html>", {
            headers: { "content-type": "text/html" },
          });
        }
        return new Response("missing", { status: 404 });
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("prism");
  });
});
