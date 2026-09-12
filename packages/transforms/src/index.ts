/**
 * Pure transform stubs. No I/O, no agency fetches.
 * Implementations land with the first compose pipeline — keep these side-effect free.
 */

export type NumericSeries = readonly number[];

/** Year-over-year percent change. Stub: returns NaN-aligned output. */
export function yoy(values: NumericSeries, periodsPerYear = 12): number[] {
  return values.map((value, index) => {
    const prior = values[index - periodsPerYear];
    if (prior === undefined || prior === 0 || !Number.isFinite(value)) {
      return Number.NaN;
    }
    return ((value - prior) / prior) * 100;
  });
}

/** Month-over-month percent change. Stub aligned to one period. */
export function mom(values: NumericSeries): number[] {
  return yoy(values, 1);
}

/**
 * Deflate a nominal series by a price index (same length, same vintage).
 * Stub: element-wise nominal / (index / 100). Callers must align dates first.
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
