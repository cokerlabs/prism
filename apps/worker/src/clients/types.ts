import type { Observation } from "@prism/spec";

export type FetchedSeries = {
  observations: Observation[];
  sourceUrl: string;
  observationStart?: string;
  observationEnd?: string;
};

export type FetchRuntime = {
  fetch: typeof fetch;
};
