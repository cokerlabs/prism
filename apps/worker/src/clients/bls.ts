import type { Observation } from "@prism/spec";
import { DataSourceUnavailableError } from "./errors";
import type { FetchRuntime, FetchedSeries } from "./types";

const BLS_TIMESERIES = "https://api.bls.gov/publicAPI/v2/timeseries/data/";

export type BlsPeriodRow = {
  year?: string;
  period?: string;
  value?: string;
};

export type BlsPayload = {
  status?: string;
  Results?: {
    series?: Array<{
      seriesID?: string;
      data?: BlsPeriodRow[];
    }>;
  };
};

export type BlsFetchOptions = {
  apiKey?: string;
  seriesId: string;
  observationStart?: string;
  observationEnd?: string;
};

function periodToDate(year: string, period: string): string {
  if (period === "M13" || period.startsWith("A")) {
    return `${year}-01-01`;
  }
  if (period.startsWith("Q")) {
    const quarter = Number(period.slice(1));
    const month = String((quarter - 1) * 3 + 1).padStart(2, "0");
    return `${year}-${month}-01`;
  }
  if (period.startsWith("M")) {
    return `${year}-${period.slice(1)}-01`;
  }
  return `${year}-01-01`;
}

export function parseBlsObservations(payload: BlsPayload): Observation[] {
  const rows = payload.Results?.series?.[0]?.data ?? [];
  return [...rows]
    .reverse()
    .map((row) => {
      const raw = row.value?.trim() ?? "";
      const parsed = raw === "" || raw === "-" ? Number.NaN : Number(raw);
      return {
        date: periodToDate(row.year ?? "", row.period ?? "A01"),
        value: Number.isFinite(parsed) ? parsed : null,
      };
    });
}

export function publicBlsSeriesUrl(seriesId: string): string {
  return `https://data.bls.gov/timeseries/${encodeURIComponent(seriesId)}`;
}

export async function fetchBlsSeries(
  options: BlsFetchOptions,
  runtime: FetchRuntime,
): Promise<FetchedSeries> {
  if (!options.apiKey) {
    throw new DataSourceUnavailableError("BLS");
  }

  const endYear = options.observationEnd?.slice(0, 4) ?? String(
    new Date().getUTCFullYear(),
  );
  const startYear =
    options.observationStart?.slice(0, 4) ?? String(Number(endYear) - 20);

  let response: Response;
  try {
    response = await runtime.fetch(BLS_TIMESERIES, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        seriesid: [options.seriesId],
        startyear: startYear,
        endyear: endYear,
        registrationkey: options.apiKey,
      }),
    });
  } catch {
    throw new DataSourceUnavailableError("BLS");
  }

  if (!response.ok) {
    throw new DataSourceUnavailableError("BLS");
  }

  const payload = (await response.json()) as BlsPayload;
  if (payload.status !== "REQUEST_SUCCEEDED") {
    throw new DataSourceUnavailableError("BLS");
  }

  return {
    observations: parseBlsObservations(payload),
    sourceUrl: publicBlsSeriesUrl(options.seriesId),
    observationStart: options.observationStart ?? `${startYear}-01-01`,
    observationEnd: options.observationEnd,
  };
}
