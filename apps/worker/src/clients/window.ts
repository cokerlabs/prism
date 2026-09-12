export const DEFAULT_HISTORY_YEARS = 20;

export function defaultObservationStart(now: Date): string {
  const year = now.getUTCFullYear() - DEFAULT_HISTORY_YEARS;
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
