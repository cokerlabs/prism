import type { Concept } from "@prism/catalog";
import { resolveSeries } from "@prism/resolver";
import type {
  Observation,
  ObservationTransform,
  ProvenanceEcho,
  SeriesRequest,
} from "@prism/spec";
import { applyTransform } from "@prism/transforms";
import {
  cacheTtlSeconds,
  createKvCache,
  createMemoryCache,
  parseFetchedSeries,
  serializeFetchedSeries,
  seriesCacheKey,
  type SeriesCache,
} from "./clients/cache";
import { DataSourceUnavailableError } from "./clients/errors";
import { fetchFredSeries } from "./clients/fred";
import type { RateGate, PoliteClock } from "./clients/polite";
import type { FetchedSeries } from "./clients/types";
import { defaultObservationStart } from "./clients/window";

export type WorkerEnv = {
  FRED_API_KEY?: string;
  CACHE?: KVNamespace;
};

export type SeriesRuntime = {
  fetch: typeof fetch;
  now?: () => Date;
  observationSource?: "live" | "recorded" | "cached";
  clock?: PoliteClock;
  gate?: RateGate;
  random?: () => number;
  cache?: SeriesCache;
};

const sharedMemoryCache = createMemoryCache();

export function cacheStoreFor(env: WorkerEnv, runtime: SeriesRuntime): SeriesCache {
  if (runtime.cache) {
    return runtime.cache;
  }
  if (env.CACHE) {
    return createKvCache(env.CACHE);
  }
  return sharedMemoryCache;
}

export type SeriesOk = {
  status: "ok";
  conceptId: string;
  nativeId: string;
  observations: Observation[];
  provenance: ProvenanceEcho;
};

export type SeriesClarify = {
  status: "clarify";
  reason: "seasonal_adjustment_mismatch" | "price_basis_mismatch";
  message: string;
  requested: {
    seasonal_adjustment?: SeriesRequest["seasonal_adjustment"];
    price_basis?: SeriesRequest["price_basis"];
  };
  catalog: {
    conceptId: string;
    nativeId: string;
    seasonal_adjustment: Concept["seasonalAdjustment"];
    price_basis?: Concept["priceBasis"];
  };
  choices: Array<{
    dimension: "seasonal_adjustment" | "price_basis";
    value: string;
    seriesId: string;
    conceptId?: string;
    label: string;
  }>;
};

export type SeriesFailure =
  | { status: "not_found"; conceptId: string }
  | { status: "invalid"; message: string }
  | { status: "unavailable"; message: string };

export type SeriesResult = SeriesOk | SeriesClarify | SeriesFailure;

async function fetchNative(
  concept: Concept,
  request: SeriesRequest,
  env: WorkerEnv,
  runtime: SeriesRuntime,
  observationStart: string,
): Promise<FetchedSeries> {
  if (concept.distributor !== "FRED") {
    throw new DataSourceUnavailableError(concept.distributor);
  }
  return fetchFredSeries(
    {
      apiKey: env.FRED_API_KEY,
      seriesId: concept.seriesId,
      observationStart,
      observationEnd: request.observation_end,
      vintagePolicy: request.vintage_policy,
      asOf: request.as_of,
    },
    runtime,
  );
}

function provenanceEcho(
  concept: Concept,
  request: SeriesRequest,
  requestedId: string,
  fetched: FetchedSeries,
  transform: ObservationTransform,
  retrievedAt: string,
  observationSource: "live" | "recorded" | "cached",
): ProvenanceEcho {
  return {
    conceptId: concept.id,
    label: concept.label,
    agency: concept.agency,
    distributor: concept.distributor,
    nativeId: concept.seriesId,
    tableId: concept.tableId,
    seasonalAdjustment: concept.seasonalAdjustment,
    priceBasis: concept.priceBasis,
    priceKind: concept.priceKind,
    frequency: concept.frequency,
    unit: concept.unit,
    geography: concept.geography,
    transform,
    vintagePolicy: request.vintage_policy,
    asOf: request.as_of,
    observationStart: fetched.observationStart ?? request.observation_start,
    observationEnd: fetched.observationEnd ?? request.observation_end,
    retrievedAt,
    observationSource,
    sourceUrl: fetched.sourceUrl,
    notes: concept.notes,
    requested: {
      conceptId: requestedId,
      seasonal_adjustment: request.seasonal_adjustment,
      price_basis: request.price_basis,
      transform: request.transform,
      vintage_policy: request.vintage_policy,
      as_of: request.as_of,
      observation_start: request.observation_start,
      observation_end: request.observation_end,
    },
  };
}

export async function loadSeries(
  conceptId: string,
  request: SeriesRequest,
  env: WorkerEnv,
  runtime: SeriesRuntime,
): Promise<SeriesResult> {
  const resolved = resolveSeries({
    conceptId,
    seasonalAdjustment: request.seasonal_adjustment,
    priceBasis: request.price_basis,
    transform: request.transform,
    vintagePolicy: request.vintage_policy,
    asOf: request.as_of,
  });

  if (resolved.status === "not_found") {
    return resolved;
  }
  if (resolved.status === "invalid") {
    return resolved;
  }
  if (resolved.status === "clarify") {
    return {
      status: "clarify",
      reason: resolved.reason,
      message: resolved.message,
      requested: {
        seasonal_adjustment: request.seasonal_adjustment,
        price_basis: request.price_basis,
      },
      catalog: {
        conceptId: resolved.concept.id,
        nativeId: resolved.nativeId,
        seasonal_adjustment: resolved.catalog.seasonalAdjustment,
        price_basis: resolved.catalog.priceBasis,
      },
      choices: resolved.choices,
    };
  }

  const now = runtime.now?.() ?? new Date();
  const observationStart =
    request.observation_start ?? defaultObservationStart(now);
  const windowed: SeriesRequest = {
    ...request,
    observation_start: observationStart,
  };

  try {
    const cache = cacheStoreFor(env, runtime);
    const key = seriesCacheKey({
      source: resolved.concept.distributor,
      nativeId: resolved.nativeId,
      observationStart,
      observationEnd: request.observation_end,
      vintagePolicy: request.vintage_policy,
      asOf: request.as_of,
    });
    const cachedRaw = await cache.get(key);
    let fetched: FetchedSeries;
    let observationSource: "live" | "recorded" | "cached";
    if (cachedRaw) {
      fetched = parseFetchedSeries(cachedRaw);
      observationSource =
        runtime.observationSource === "recorded" ? "recorded" : "cached";
    } else {
      fetched = await fetchNative(
        resolved.concept,
        windowed,
        env,
        runtime,
        observationStart,
      );
      await cache.set(
        key,
        serializeFetchedSeries(fetched),
        cacheTtlSeconds(resolved.concept.frequency),
      );
      observationSource = runtime.observationSource ?? "live";
    }
    const observations = applyTransform(
      fetched.observations,
      resolved.transform,
      resolved.concept.frequency,
    );
    const retrievedAt = now.toISOString();
    return {
      status: "ok",
      conceptId: resolved.concept.id,
      nativeId: resolved.nativeId,
      observations,
      provenance: provenanceEcho(
        resolved.concept,
        request,
        conceptId,
        {
          ...fetched,
          observationStart: fetched.observationStart ?? observationStart,
        },
        resolved.transform,
        retrievedAt,
        observationSource,
      ),
    };
  } catch (error) {
    if (error instanceof DataSourceUnavailableError) {
      return { status: "unavailable", message: error.message };
    }
    throw error;
  }
}
