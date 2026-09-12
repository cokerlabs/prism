import { describe, expect, it } from "vitest";
import {
  applyTransform,
  deflate,
  indexToBase,
  level,
  mom,
  pc1,
  periodsForFrequency,
  yoy,
} from "../src/index";

describe("transforms", () => {
  it("returns published levels unchanged", () => {
    expect(level([100, 110.5])).toEqual([100, 110.5]);
    expect(Number.isNaN(level([Number.NaN])[0])).toBe(true);
  });

  it("computes pc1 as year-over-year percent change", () => {
    const values = [100, 100, 110];
    expect(pc1(values, 2)[2]).toBeCloseTo(10);
    expect(Number.isNaN(pc1(values, 2)[0])).toBe(true);
    expect(yoy(values, 2)[2]).toBeCloseTo(10);
  });

  it("uses frequency to choose the pc1 lag", () => {
    expect(periodsForFrequency("monthly")).toBe(12);
    expect(periodsForFrequency("quarterly")).toBe(4);
    const monthly = Array.from({ length: 13 }, (_, index) => 100 + index);
    const observations = monthly.map((value, index) => ({
      date: `2024-${String(index + 1).padStart(2, "0")}-01`,
      value,
    }));
    const transformed = applyTransform(observations, "pc1", "monthly");
    expect(transformed[12]?.value).toBeCloseTo(12);
    expect(transformed[0]?.value).toBeNull();
  });

  it("deflates nominal by a price index", () => {
    expect(deflate([110], [110])[0]).toBeCloseTo(100);
  });

  it("rebases and supports mom as a one-period change", () => {
    expect(indexToBase([50, 75])[1]).toBeCloseTo(150);
    expect(mom([100, 101])[1]).toBeCloseTo(1);
  });
});
