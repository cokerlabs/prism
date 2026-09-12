import { describe, expect, it } from "vitest";
import { resolveSeries } from "../src/index";

describe("resolver", () => {
  it("resolves a curated concept to its native id", () => {
    const resolved = resolveSeries({ conceptId: "cpi-u-all-items" });
    expect(resolved.status).toBe("ok");
    if (resolved.status !== "ok") {
      return;
    }
    expect(resolved.nativeId).toBe("CPIAUCSL");
    expect(resolved.seasonalAdjustment).toBe("SA");
    expect(resolved.priceBasis).toBe("index");
    expect(resolved.transform).toBe("level");
    expect(resolved.vintagePolicy).toBe("latest");
  });

  it("resolves FRED series ids to the same concept", () => {
    const resolved = resolveSeries({ conceptId: "UNRATE" });
    expect(resolved.status).toBe("ok");
    if (resolved.status !== "ok") {
      return;
    }
    expect(resolved.concept.id).toBe("unemployment-rate");
    expect(resolved.nativeId).toBe("UNRATE");
  });

  it("refuses a silent SA to NSA remap and returns clarify choices", () => {
    const resolved = resolveSeries({
      conceptId: "cpi-u-all-items",
      seasonalAdjustment: "NSA",
    });
    expect(resolved.status).toBe("clarify");
    if (resolved.status !== "clarify") {
      return;
    }
    expect(resolved.reason).toBe("seasonal_adjustment_mismatch");
    expect(resolved.nativeId).toBe("CPIAUCSL");
    expect(resolved.choices.map((choice) => choice.seriesId)).toEqual([
      "CPIAUCSL",
      "CPIAUCNS",
    ]);
    expect(resolved.choices[1]?.value).toBe("NSA");
  });

  it("refuses a silent real/nominal remap for AHE", () => {
    const resolved = resolveSeries({
      conceptId: "ahe-private",
      priceBasis: "real",
    });
    expect(resolved.status).toBe("clarify");
    if (resolved.status !== "clarify") {
      return;
    }
    expect(resolved.reason).toBe("price_basis_mismatch");
    expect(resolved.nativeId).toBe("CES0500000003");
    expect(resolved.choices[0]?.value).toBe("nominal");
    expect(resolved.choices.some((choice) => choice.value === "real")).toBe(
      false,
    );
  });

  it("refuses a silent real to nominal remap for GDPC1", () => {
    const resolved = resolveSeries({
      conceptId: "GDPC1",
      priceBasis: "nominal",
    });
    expect(resolved.status).toBe("clarify");
    if (resolved.status !== "clarify") {
      return;
    }
    expect(resolved.choices.map((choice) => choice.seriesId)).toEqual([
      "GDPC1",
      "GDP",
    ]);
  });

  it("does not invent a price basis for a rate series", () => {
    const resolved = resolveSeries({
      conceptId: "unemployment-rate",
      priceBasis: "real",
    });
    expect(resolved.status).toBe("clarify");
    if (resolved.status !== "clarify") {
      return;
    }
    expect(resolved.reason).toBe("price_basis_mismatch");
    expect(resolved.catalog.priceBasis).toBeUndefined();
  });

  it("requires as_of when vintage_policy is as_of", () => {
    const resolved = resolveSeries({
      conceptId: "PAYEMS",
      vintagePolicy: "as_of",
    });
    expect(resolved).toEqual({
      status: "invalid",
      message: "as_of vintage requires an as_of date",
    });
  });

  it("returns not_found for an unknown concept", () => {
    expect(resolveSeries({ conceptId: "not-a-series" })).toEqual({
      status: "not_found",
      conceptId: "not-a-series",
    });
  });
});
