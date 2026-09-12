import { describe, expect, it } from "vitest";
import { deflate, indexToBase, mom, yoy } from "../src/index";

describe("transform stubs", () => {
  it("computes year-over-year percent change", () => {
    const values = [100, 100, 110];
    expect(yoy(values, 2)[2]).toBeCloseTo(10);
    expect(Number.isNaN(yoy(values, 2)[0])).toBe(true);
  });

  it("deflates nominal by a price index", () => {
    expect(deflate([110], [110])[0]).toBeCloseTo(100);
  });

  it("rebases and supports mom as a one-period yoy", () => {
    expect(indexToBase([50, 75])[1]).toBeCloseTo(150);
    expect(mom([100, 101])[1]).toBeCloseTo(1);
  });
});
