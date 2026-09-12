import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ViewSpec, parseViewSpec } from "../src/view-spec";

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
