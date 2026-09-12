import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SeriesRequest } from "../src/series";
import {
  ObservationTransform,
  PriceBasis,
  SeasonalAdjustment,
  VintagePolicy,
  ViewSpec,
  parseViewSpec,
} from "../src/view-spec";

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/real-wage-growth-vs-cpi.json",
);

describe("ViewSpec", () => {
  it("parses the real wage growth vs CPI fixture", () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseViewSpec(raw);

    expect(spec.version).toBe("0.1.0");
    expect(spec.id).toBe("real-wage-growth-vs-cpi");
    expect(spec.layout.kind).toBe("stack");
    if (spec.layout.kind !== "stack") {
      throw new Error("expected root stack");
    }
    const types = spec.layout.children
      .filter((node) => node.kind === "primitive")
      .map((node) => node.primitive.type);
    expect(types).toEqual([
      "LineChart",
      "StatTable",
      "Annotation",
      "ProvenanceBlock",
    ]);
  });

  it("rejects an unversioned payload", () => {
    const result = ViewSpec.safeParse({ id: "x", title: "x" });
    expect(result.success).toBe(false);
  });
});

describe("series enums", () => {
  it("accepts forced seasonal, price, transform, and vintage values", () => {
    expect(SeasonalAdjustment.parse("NA")).toBe("NA");
    expect(PriceBasis.parse("real")).toBe("real");
    expect(ObservationTransform.parse("pc1")).toBe("pc1");
    expect(VintagePolicy.parse("as_of")).toBe("as_of");
    expect(SeriesRequest.parse({}).transform).toBe("level");
    expect(SeriesRequest.parse({}).vintage_policy).toBe("latest");
  });
});

