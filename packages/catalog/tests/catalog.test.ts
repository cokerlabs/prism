import { describe, expect, it } from "vitest";
import { catalog, getConcept, getConceptBySeriesId } from "../src/index";

const expectedSeries = [
  "CPIAUCSL",
  "CPILFESL",
  "UNRATE",
  "PAYEMS",
  "CES0500000003",
  "GDPC1",
  "FEDFUNDS",
  "HOUST",
  "DGS10",
  "PCEPI",
  "B19013_001E",
  "B23025_001E",
];

describe("catalog stub", () => {
  it("includes the first curated FRED / BLS / ACS concepts", () => {
    const ids = catalog.concepts.map((concept) => concept.seriesId);
    expect(ids).toEqual(expectedSeries);
    expect(catalog.concepts.length).toBeGreaterThanOrEqual(10);
    expect(catalog.concepts.length).toBeLessThanOrEqual(14);
  });

  it("forces SA/NSA and price-kind enums on every concept", () => {
    for (const concept of catalog.concepts) {
      expect(["SA", "NSA"]).toContain(concept.seasonalAdjustment);
      expect(["nominal", "real", "index", "rate", "count"]).toContain(
        concept.priceKind,
      );
    }
  });

  it("looks up AHE by CES id and ACS tables by table id notes", () => {
    expect(getConcept("ahe-private")?.aliases).toContain("AHE");
    expect(getConceptBySeriesId("CES0500000003")?.id).toBe("ahe-private");
    expect(getConcept("acs-median-hh-income")?.tableId).toBe("B19013");
    expect(getConcept("acs-employment-status")?.tableId).toBe("B23025");
    expect(getConcept("acs-median-hh-income")?.distributor).toBe("ACS");
  });
});
