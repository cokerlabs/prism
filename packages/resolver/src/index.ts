import {
  getConcept,
  getConceptBySeriesId,
  type Concept,
  type Counterpart,
} from "@prism/catalog";
import type {
  ObservationTransform,
  PriceBasis,
  SeasonalAdjustment,
  VintagePolicy,
} from "@prism/spec";

export type ResolveQuery = {
  conceptId: string;
  seasonalAdjustment?: SeasonalAdjustment;
  priceBasis?: PriceBasis;
  transform?: ObservationTransform;
  vintagePolicy?: VintagePolicy;
  asOf?: string;
};

export type ClarifyChoice = {
  dimension: "seasonal_adjustment" | "price_basis";
  value: string;
  seriesId: string;
  conceptId?: string;
  label: string;
};

export type ResolveOk = {
  status: "ok";
  concept: Concept;
  nativeId: string;
  seasonalAdjustment: SeasonalAdjustment;
  priceBasis?: PriceBasis;
  transform: ObservationTransform;
  vintagePolicy: VintagePolicy;
  asOf?: string;
};

export type ResolveClarify = {
  status: "clarify";
  reason: "seasonal_adjustment_mismatch" | "price_basis_mismatch";
  message: string;
  concept: Concept;
  nativeId: string;
  requested: {
    seasonalAdjustment?: SeasonalAdjustment;
    priceBasis?: PriceBasis;
  };
  catalog: {
    seasonalAdjustment: SeasonalAdjustment;
    priceBasis?: PriceBasis;
  };
  choices: ClarifyChoice[];
};

export type ResolveNotFound = {
  status: "not_found";
  conceptId: string;
};

export type ResolveInvalid = {
  status: "invalid";
  message: string;
};

export type ResolveResult =
  | ResolveOk
  | ResolveClarify
  | ResolveNotFound
  | ResolveInvalid;

export function findConcept(conceptId: string): Concept | undefined {
  return getConcept(conceptId) ?? getConceptBySeriesId(conceptId);
}

function counterpartChoices(
  concept: Concept,
  dimension: Counterpart["dimension"],
): ClarifyChoice[] {
  const catalogChoice: ClarifyChoice = {
    dimension,
    value:
      dimension === "seasonal_adjustment"
        ? concept.seasonalAdjustment
        : (concept.priceBasis ?? concept.priceKind),
    seriesId: concept.seriesId,
    conceptId: concept.id,
    label: concept.label,
  };
  const extras = (concept.counterparts ?? [])
    .filter((counterpart) => counterpart.dimension === dimension)
    .map((counterpart) => ({
      dimension: counterpart.dimension,
      value: counterpart.value,
      seriesId: counterpart.seriesId,
      conceptId: counterpart.conceptId,
      label: counterpart.label,
    }));
  return [catalogChoice, ...extras];
}

export function resolveSeries(query: ResolveQuery): ResolveResult {
  const concept = findConcept(query.conceptId);
  if (!concept) {
    return { status: "not_found", conceptId: query.conceptId };
  }

  const transform = query.transform ?? "level";
  const vintagePolicy = query.vintagePolicy ?? "latest";

  if (vintagePolicy === "as_of" && !query.asOf) {
    return {
      status: "invalid",
      message: "as_of vintage requires an as_of date",
    };
  }

  if (
    query.seasonalAdjustment !== undefined &&
    query.seasonalAdjustment !== concept.seasonalAdjustment
  ) {
    return {
      status: "clarify",
      reason: "seasonal_adjustment_mismatch",
      message:
        "This series does not match the requested seasonal adjustment. Prism does not remap SA and NSA.",
      concept,
      nativeId: concept.seriesId,
      requested: {
        seasonalAdjustment: query.seasonalAdjustment,
        priceBasis: query.priceBasis,
      },
      catalog: {
        seasonalAdjustment: concept.seasonalAdjustment,
        priceBasis: concept.priceBasis,
      },
      choices: counterpartChoices(concept, "seasonal_adjustment"),
    };
  }

  if (query.priceBasis !== undefined) {
    const catalogBasis = concept.priceBasis;
    if (catalogBasis === undefined || catalogBasis !== query.priceBasis) {
      return {
        status: "clarify",
        reason: "price_basis_mismatch",
        message:
          catalogBasis === undefined
            ? "This series is not a price series. Prism does not assign a real or nominal basis."
            : "This series does not match the requested price basis. Prism does not remap real and nominal.",
        concept,
        nativeId: concept.seriesId,
        requested: {
          seasonalAdjustment: query.seasonalAdjustment,
          priceBasis: query.priceBasis,
        },
        catalog: {
          seasonalAdjustment: concept.seasonalAdjustment,
          priceBasis: concept.priceBasis,
        },
        choices: counterpartChoices(concept, "price_basis"),
      };
    }
  }

  return {
    status: "ok",
    concept,
    nativeId: concept.seriesId,
    seasonalAdjustment: concept.seasonalAdjustment,
    priceBasis: concept.priceBasis,
    transform,
    vintagePolicy,
    asOf: vintagePolicy === "as_of" ? query.asOf : undefined,
  };
}
