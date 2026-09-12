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

describe("catalog", () => {
  it("includes the curated FRED / BLS / ACS concepts", () => {
    const ids = catalog.concepts.map((concept) => concept.seriesId);
    expect(ids).toEqual(expectedSeries);
    expect(catalog.concepts.length).toBeGreaterThanOrEqual(10);
    expect(catalog.concepts.length).toBeLessThanOrEqual(14);
  });

  it("forces seasonal adjustment, price kind, and price basis enums", () => {
    for (const concept of catalog.concepts) {
      expect(["SA", "NSA", "NA"]).toContain(concept.seasonalAdjustment);
      expect(["nominal", "real", "index", "rate", "count"]).toContain(
        concept.priceKind,
      );
      if (concept.priceBasis !== undefined) {
        expect(["nominal", "real", "index"]).toContain(concept.priceBasis);
      }
    }
    expect(getConcept("cpi-u-all-items")?.priceBasis).toBe("index");
    expect(getConcept("ahe-private")?.priceBasis).toBe("nominal");
    expect(getConcept("real-gdp")?.priceBasis).toBe("real");
    expect(getConcept("acs-median-hh-income")?.seasonalAdjustment).toBe("NA");
    expect(getConcept("acs-employment-status")?.seasonalAdjustment).toBe("NA");
  });

  it("records NSA / nominal counterparts without treating them as aliases", () => {
    const cpi = getConcept("cpi-u-all-items");
    expect(cpi?.counterparts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dimension: "seasonal_adjustment",
          value: "NSA",
          seriesId: "CPIAUCNS",
        }),
      ]),
    );
    expect(getConceptBySeriesId("CPIAUCNS")).toBeUndefined();
    expect(getConcept("real-gdp")?.counterparts?.[0]?.seriesId).toBe("GDP");
  });

  it("looks up AHE by CES id and ACS tables by table id notes", () => {
    expect(getConcept("ahe-private")?.aliases).toContain("AHE");
    expect(getConceptBySeriesId("CES0500000003")?.id).toBe("ahe-private");
    expect(getConcept("acs-median-hh-income")?.tableId).toBe("B19013");
    expect(getConcept("acs-employment-status")?.tableId).toBe("B23025");
    expect(getConcept("acs-median-hh-income")?.distributor).toBe("ACS");
    expect(getConcept("acs-median-hh-income")?.priceBasis).toBe("nominal");
  });
});
