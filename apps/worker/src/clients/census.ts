import type { Observation } from "@prism/spec";
import { DataSourceUnavailableError } from "./errors";
import { politeFetch } from "./polite";
import type { FetchRuntime, FetchedSeries } from "./types";

export type CensusTable = string[][];

export type CensusFetchOptions = {
  apiKey?: string;
  variable: string;
  year?: string;
  product?: "acs1" | "acs5";
};

function latestAcsYear(now: Date): number {
  return now.getUTCFullYear() - 2;
}

export function parseCensusObservations(
  table: CensusTable,
  year: string,
): Observation[] {
  if (table.length < 2 || !table[1] || table[1].length < 2) {
    return [];
  }
  const raw = table[1][1]?.trim() ?? "";
  const parsed = raw === "" || raw === "null" ? Number.NaN : Number(raw);
  return [
    {
      date: `${year}-01-01`,
      value: Number.isFinite(parsed) ? parsed : null,
    },
  ];
}

export function publicCensusUrl(year: string, product: string): string {
  return `https://api.census.gov/data/${year}/acs/${product}`;
}

export async function fetchCensusSeries(
  options: CensusFetchOptions,
  runtime: FetchRuntime,
  now = new Date(),
): Promise<FetchedSeries> {
  if (!options.apiKey) {
    throw new DataSourceUnavailableError("Census");
  }

  const product = options.product ?? "acs1";
  const year = options.year ?? String(latestAcsYear(now));
  const url = new URL(`https://api.census.gov/data/${year}/acs/${product}`);
  url.searchParams.set("get", `NAME,${options.variable}`);
  url.searchParams.set("for", "us:1");
  url.searchParams.set("key", options.apiKey);

  let response: Response;
  try {
    response = await politeFetch(url, undefined, {
      fetch: runtime.fetch,
      clock: runtime.clock,
      gate: runtime.gate,
      random: runtime.random,
      source: "Census",
    });
  } catch (error) {
    if (error instanceof DataSourceUnavailableError) {
      throw error;
    }
    throw new DataSourceUnavailableError("Census");
  }

  if (!response.ok) {
    throw new DataSourceUnavailableError("Census");
  }

  const table = (await response.json()) as CensusTable;
  if (!Array.isArray(table)) {
    throw new DataSourceUnavailableError("Census");
  }

  return {
    observations: parseCensusObservations(table, year),
    sourceUrl: publicCensusUrl(year, product),
    observationStart: `${year}-01-01`,
    observationEnd: `${year}-12-31`,
  };
}
