import type { Concept } from "@prism/catalog";
import { resolveSeries } from "@prism/resolver";
import type {
  Observation,
  ObservationTransform,
  ProvenanceEcho,
  SeriesRequest,
} from "@prism/spec";
import { applyTransform } from "@prism/transforms";
import { fetchBlsSeries } from "./clients/bls";
import { fetchCensusSeries } from "./clients/census";
import { DataSourceUnavailableError } from "./clients/errors";
import { fetchFredSeries } from "./clients/fred";
import type { FetchedSeries } from "./clients/types";

export type WorkerEnv = {
  FRED_API_KEY?: string;
  BLS_API_KEY?: string;
  CENSUS_API_KEY?: string;
};

export type SeriesRuntime = {
  fetch: typeof fetch;
  now?: () => Date;
  observationSource?: "live" | "recorded";
};

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
): Promise<FetchedSeries> {
  if (concept.distributor === "FRED") {
    return fetchFredSeries(
      {
        apiKey: env.FRED_API_KEY,
        seriesId: concept.seriesId,
        observationStart: request.observation_start,
        observationEnd: request.observation_end,
        vintagePolicy: request.vintage_policy,
        asOf: request.as_of,
      },
      runtime,
    );
  }
  if (concept.distributor === "BLS") {
    return fetchBlsSeries(
      {
        apiKey: env.BLS_API_KEY,
        seriesId: concept.seriesId,
        observationStart: request.observation_start,
        observationEnd: request.observation_end,
      },
      runtime,
    );
  }
  if (concept.distributor === "ACS") {
    const now = runtime.now?.() ?? new Date();
    return fetchCensusSeries(
      {
        apiKey: env.CENSUS_API_KEY,
        variable: concept.seriesId,
        year: request.as_of?.slice(0, 4) ?? request.observation_end?.slice(0, 4),
      },
      runtime,
      now,
    );
  }
  throw new DataSourceUnavailableError(concept.distributor);
}

function provenanceEcho(
  concept: Concept,
  request: SeriesRequest,
  requestedId: string,
  fetched: FetchedSeries,
  transform: ObservationTransform,
  retrievedAt: string,
  observationSource: "live" | "recorded",
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

  try {
    const fetched = await fetchNative(resolved.concept, request, env, runtime);
    const observations = applyTransform(
      fetched.observations,
      resolved.transform,
      resolved.concept.frequency,
    );
    const retrievedAt = (runtime.now?.() ?? new Date()).toISOString();
    return {
      status: "ok",
      conceptId: resolved.concept.id,
      nativeId: resolved.nativeId,
      observations,
      provenance: provenanceEcho(
        resolved.concept,
        request,
        conceptId,
        fetched,
        resolved.transform,
        retrievedAt,
        runtime.observationSource ?? "live",
      ),
    };
  } catch (error) {
    if (error instanceof DataSourceUnavailableError) {
      return { status: "unavailable", message: error.message };
    }
    throw error;
  }
}
