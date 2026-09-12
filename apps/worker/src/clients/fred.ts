import type { Observation } from "@prism/spec";
import { DataSourceUnavailableError } from "./errors";
import { politeFetch } from "./polite";
import type { FetchRuntime, FetchedSeries } from "./types";
import { defaultObservationStart } from "./window";

const FRED_OBSERVATIONS =
  "https://api.stlouisfed.org/fred/series/observations";

export type FredObservationRow = {
  date?: string;
  value?: string;
};

export type FredObservationsPayload = {
  observation_start?: string;
  observation_end?: string;
  observations?: FredObservationRow[];
  error_code?: number;
};

export type FredFetchOptions = {
  apiKey?: string;
  seriesId: string;
  observationStart?: string;
  observationEnd?: string;
  vintagePolicy: "latest" | "as_of";
  asOf?: string;
};

export function parseFredObservations(
  payload: FredObservationsPayload,
): Observation[] {
  return (payload.observations ?? []).map((row) => {
    const raw = row.value?.trim() ?? "";
    const parsed = raw === "" || raw === "." ? Number.NaN : Number(raw);
    return {
      date: row.date ?? "",
      value: Number.isFinite(parsed) ? parsed : null,
    };
  });
}

export function publicFredSeriesUrl(seriesId: string): string {
  return `https://fred.stlouisfed.org/series/${encodeURIComponent(seriesId)}`;
}

export async function fetchFredSeries(
  options: FredFetchOptions,
  runtime: FetchRuntime,
): Promise<FetchedSeries> {
  if (!options.apiKey) {
    throw new DataSourceUnavailableError("FRED");
  }

  const observationStart =
    options.observationStart ?? defaultObservationStart(new Date());
  const url = new URL(FRED_OBSERVATIONS);
  url.searchParams.set("series_id", options.seriesId);
  url.searchParams.set("api_key", options.apiKey);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("observation_start", observationStart);
  if (options.observationEnd) {
    url.searchParams.set("observation_end", options.observationEnd);
  }
  if (options.vintagePolicy === "as_of" && options.asOf) {
    url.searchParams.set("realtime_start", options.asOf);
    url.searchParams.set("realtime_end", options.asOf);
  }

  let response: Response;
  try {
    response = await politeFetch(url, undefined, {
      fetch: runtime.fetch,
      clock: runtime.clock,
      gate: runtime.gate,
      random: runtime.random,
      source: "FRED",
    });
  } catch (error) {
    if (error instanceof DataSourceUnavailableError) {
      throw error;
    }
    throw new DataSourceUnavailableError("FRED");
  }

  if (!response.ok) {
    throw new DataSourceUnavailableError("FRED");
  }

  const payload = (await response.json()) as FredObservationsPayload;
  if (payload.error_code) {
    throw new DataSourceUnavailableError("FRED");
  }

  return {
    observations: parseFredObservations(payload),
    sourceUrl: publicFredSeriesUrl(options.seriesId),
    observationStart: payload.observation_start ?? observationStart,
    observationEnd: payload.observation_end ?? options.observationEnd,
  };
}
