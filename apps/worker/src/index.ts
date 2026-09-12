import { listConcepts } from "@prism/catalog";
import { SeriesRequest } from "@prism/spec";
import { DATA_SOURCE_UNAVAILABLE } from "./clients/errors";
import { loadSeries, type SeriesRuntime, type WorkerEnv } from "./series";

export interface Env extends WorkerEnv {
  DB: D1Database;
  ASSETS: Fetcher;
}

export type Runtime = SeriesRuntime;

const BASE_PATH = "/in/prism";
const API_PATH = `${BASE_PATH}/api`;

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export function text(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function defaultRuntime(): Runtime {
  return { fetch: globalThis.fetch, observationSource: "live" };
}

function parseSeriesRequest(url: URL): SeriesRequest | { error: string } {
  const parsed = SeriesRequest.safeParse({
    seasonal_adjustment: url.searchParams.get("seasonal_adjustment") ?? undefined,
    price_basis: url.searchParams.get("price_basis") ?? undefined,
    transform: url.searchParams.get("transform") ?? undefined,
    vintage_policy: url.searchParams.get("vintage_policy") ?? undefined,
    as_of: url.searchParams.get("as_of") ?? undefined,
    observation_start: url.searchParams.get("observation_start") ?? undefined,
    observation_end: url.searchParams.get("observation_end") ?? undefined,
  });
  if (!parsed.success) {
    return { error: "Invalid series request" };
  }
  return parsed.data;
}

export async function handleRequest(
  request: Request,
  env: Env,
  runtime: Runtime = defaultRuntime(),
): Promise<Response> {
  const url = new URL(request.url);
  const path = normalizePath(url.pathname);

  if (path === `${API_PATH}/health`) {
    return json({ ok: true, service: "prism" });
  }

  if (path === `${API_PATH}/catalog`) {
    return json({
      version: "0.1.0",
      concepts: listConcepts(),
    });
  }

  const seriesMatch = /^\/in\/prism\/api\/series\/([^/]+)$/.exec(path);
  if (seriesMatch?.[1]) {
    const conceptId = decodeURIComponent(seriesMatch[1]);
    const query = parseSeriesRequest(url);
    if ("error" in query) {
      return json({ error: "invalid", service: "prism", message: query.error }, 400);
    }

    const result = await loadSeries(conceptId, query, env, runtime);
    if (result.status === "not_found") {
      return json({ error: "not_found", service: "prism" }, 404);
    }
    if (result.status === "invalid") {
      return json(
        { error: "invalid", service: "prism", message: result.message },
        400,
      );
    }
    if (result.status === "clarify") {
      return json(
        {
          error: "clarify",
          service: "prism",
          reason: result.reason,
          message: result.message,
          requested: result.requested,
          catalog: result.catalog,
          choices: result.choices,
        },
        409,
      );
    }
    if (result.status === "unavailable") {
      return json(
        {
          error: "data_source_unavailable",
          service: "prism",
          message: DATA_SOURCE_UNAVAILABLE,
        },
        503,
      );
    }
    return json({
      conceptId: result.conceptId,
      nativeId: result.nativeId,
      observations: result.observations,
      provenance: result.provenance,
    });
  }

  if (path === API_PATH || path.startsWith(`${API_PATH}/`)) {
    return json({ error: "not_found", service: "prism" }, 404);
  }

  if (path === BASE_PATH || path.startsWith(`${BASE_PATH}/`)) {
    const assetResponse = await env.ASSETS.fetch(request);
    if (assetResponse.status !== 404) {
      return assetResponse;
    }
    return env.ASSETS.fetch(
      new Request(new URL(`${BASE_PATH}/index.html`, url.origin)),
    );
  }

  return text("Not found. Prism is at /in/prism/.", 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};
