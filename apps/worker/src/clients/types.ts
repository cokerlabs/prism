import type { Observation } from "@prism/spec";
import type { RateGate, PoliteClock } from "./polite";
import type { SeriesCache } from "./cache";

export type FetchedSeries = {
  observations: Observation[];
  sourceUrl: string;
  observationStart?: string;
  observationEnd?: string;
};

export type FetchRuntime = {
  fetch: typeof fetch;
  clock?: PoliteClock;
  gate?: RateGate;
  random?: () => number;
  cache?: SeriesCache;
};
