import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseBlsObservations, type BlsPayload } from "../src/clients/bls";
import {
  parseCensusObservations,
  type CensusTable,
} from "../src/clients/census";
import { DataSourceUnavailableError } from "../src/clients/errors";
import {
  fetchFredSeries,
  parseFredObservations,
  type FredObservationsPayload,
} from "../src/clients/fred";

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/series",
);

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8")) as T;
}

describe("agency clients", () => {
  it("parses recorded FRED observations and keeps missing values null", () => {
    const payload = readJson<FredObservationsPayload>("CPIAUCSL.json");
    const observations = parseFredObservations(payload);
    expect(observations[0]).toEqual({ date: "2023-01-01", value: 300.42 });
    const gap = observations.find((row) => row.date === "2025-10-01");
    expect(gap?.value).toBeNull();
    expect(observations.at(-1)).toEqual({
      date: "2026-08-01",
      value: 334.131,
    });
  });

  it("parses recorded UNRATE and PAYEMS fixtures", () => {
    const unrate = parseFredObservations(
      readJson<FredObservationsPayload>("UNRATE.json"),
    );
    const payems = parseFredObservations(
      readJson<FredObservationsPayload>("PAYEMS.json"),
    );
    expect(unrate.at(-1)?.value).toBeCloseTo(4.1);
    expect(payems.at(-1)?.value).toBe(159075);
  });

  it("parses BLS and Census recorded payloads", () => {
    const bls = readJson<BlsPayload>("bls-UNRATE.json");
    const census = readJson<{ table: CensusTable }>("census-B19013.json");
    expect(parseBlsObservations(bls)[0]).toEqual({
      date: "2025-01-01",
      value: 4,
    });
    expect(parseCensusObservations(census.table, "2023")).toEqual([
      { date: "2023-01-01", value: 77719 },
    ]);
  });

  it("does not call FRED when the key is missing", async () => {
    await expect(
      fetchFredSeries(
        {
          seriesId: "CPIAUCSL",
          vintagePolicy: "latest",
        },
        {
          fetch: () => {
            throw new Error("network should not run");
          },
        },
      ),
    ).rejects.toBeInstanceOf(DataSourceUnavailableError);
  });

  it.skipIf(!process.env.FRED_API_KEY)(
    "fetches CPIAUCSL live when FRED_API_KEY is present",
    async () => {
      const series = await fetchFredSeries(
        {
          apiKey: process.env.FRED_API_KEY,
          seriesId: "CPIAUCSL",
          vintagePolicy: "latest",
          observationStart: "2026-01-01",
        },
        { fetch: globalThis.fetch },
      );
      expect(series.observations.length).toBeGreaterThan(0);
      expect(series.sourceUrl).toContain("CPIAUCSL");
    },
  );
});
