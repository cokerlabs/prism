export const DATA_SOURCE_UNAVAILABLE = "Data source unavailable";

export class DataSourceUnavailableError extends Error {
  readonly source: string;

  constructor(source: string) {
    super(DATA_SOURCE_UNAVAILABLE);
    this.name = "DataSourceUnavailableError";
    this.source = source;
  }
}
