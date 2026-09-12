import type { Observation, ObservationTransform } from "@prism/spec";

export type NumericSeries = readonly number[];

export type TransformFrequency =
  | "daily"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "annual";

export function periodsForFrequency(frequency: TransformFrequency): number {
  switch (frequency) {
    case "daily":
      return 365;
    case "weekly":
      return 52;
    case "monthly":
      return 12;
    case "quarterly":
      return 4;
    case "annual":
      return 1;
  }
}

/** Published level. Finite values pass through; non-finite become NaN. */
export function level(values: NumericSeries): number[] {
  return values.map((value) =>
    Number.isFinite(value) ? value : Number.NaN,
  );
}

/** Year-over-year percent change (FRED pc1). */
export function pc1(values: NumericSeries, periodsPerYear = 12): number[] {
  return values.map((value, index) => {
    const prior = values[index - periodsPerYear];
    if (
      prior === undefined ||
      prior === 0 ||
      !Number.isFinite(value) ||
      !Number.isFinite(prior)
    ) {
      return Number.NaN;
    }
    return ((value - prior) / prior) * 100;
  });
}

/** Year-over-year percent change. Alias of pc1. */
export function yoy(values: NumericSeries, periodsPerYear = 12): number[] {
  return pc1(values, periodsPerYear);
}

/** Period-over-period percent change. */
export function mom(values: NumericSeries): number[] {
  return pc1(values, 1);
}

/**
 * Deflate a nominal series by a price index (same length, same vintage).
 * Element-wise nominal / (index / 100). Callers must align dates first.
 */
export function deflate(
  nominal: NumericSeries,
  priceIndex: NumericSeries,
  indexBase = 100,
): number[] {
  const length = Math.min(nominal.length, priceIndex.length);
  return Array.from({ length }, (_, index) => {
    const price = priceIndex[index];
    const value = nominal[index];
    if (
      price === undefined ||
      value === undefined ||
      price === 0 ||
      !Number.isFinite(price) ||
      !Number.isFinite(value)
    ) {
      return Number.NaN;
    }
    return value / (price / indexBase);
  });
}

/** Rebase a series to 100 at the first finite observation. */
export function indexToBase(values: NumericSeries): number[] {
  const base = values.find((value) => Number.isFinite(value));
  if (base === undefined || base === 0) {
    return values.map(() => Number.NaN);
  }
  return values.map((value) =>
    Number.isFinite(value) ? (value / base) * 100 : Number.NaN,
  );
}

export function applyTransform(
  observations: readonly Observation[],
  transform: ObservationTransform,
  frequency: TransformFrequency,
): Observation[] {
  if (transform === "level") {
    return observations.map((observation) => ({ ...observation }));
  }
  const values = observations.map((observation) =>
    observation.value === null ? Number.NaN : observation.value,
  );
  const transformed = pc1(values, periodsForFrequency(frequency));
  return observations.map((observation, index) => {
    const value = transformed[index];
    return {
      date: observation.date,
      value: value !== undefined && Number.isFinite(value) ? value : null,
    };
  });
}
