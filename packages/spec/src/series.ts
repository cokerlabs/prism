import { z } from "zod";
import {
  Agency,
  Distributor,
  ObservationTransform,
  PriceBasis,
  PriceKind,
  SeasonalAdjustment,
  VintagePolicy,
} from "./view-spec";

export const Observation = z.object({
  date: z.string().min(1),
  value: z.number().nullable(),
});
export type Observation = z.infer<typeof Observation>;

export const SeriesRequest = z.object({
  seasonal_adjustment: SeasonalAdjustment.optional(),
  price_basis: PriceBasis.optional(),
  transform: ObservationTransform.default("level"),
  vintage_policy: VintagePolicy.default("latest"),
  as_of: z.string().min(1).optional(),
  observation_start: z.string().min(1).optional(),
  observation_end: z.string().min(1).optional(),
});
export type SeriesRequest = z.infer<typeof SeriesRequest>;

export const ProvenanceEcho = z.object({
  conceptId: z.string().min(1),
  label: z.string().min(1),
  agency: Agency,
  distributor: Distributor,
  nativeId: z.string().min(1),
  tableId: z.string().min(1).optional(),
  seasonalAdjustment: SeasonalAdjustment,
  priceBasis: PriceBasis.optional(),
  priceKind: PriceKind,
  frequency: z.string().min(1),
  unit: z.string().min(1),
  geography: z.string().min(1),
  transform: ObservationTransform,
  vintagePolicy: VintagePolicy,
  asOf: z.string().min(1).optional(),
  observationStart: z.string().min(1).optional(),
  observationEnd: z.string().min(1).optional(),
  retrievedAt: z.string().min(1),
  observationSource: z.enum(["live", "recorded", "cached"]),
  sourceUrl: z.string().min(1),
  notes: z.string().min(1),
  requested: z.object({
    conceptId: z.string().min(1),
    seasonal_adjustment: SeasonalAdjustment.optional(),
    price_basis: PriceBasis.optional(),
    transform: ObservationTransform,
    vintage_policy: VintagePolicy,
    as_of: z.string().min(1).optional(),
    observation_start: z.string().min(1).optional(),
    observation_end: z.string().min(1).optional(),
  }),
});
export type ProvenanceEcho = z.infer<typeof ProvenanceEcho>;
