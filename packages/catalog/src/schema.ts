import { z } from "zod";
import {
  Agency,
  Distributor,
  PriceBasis,
  PriceKind,
  SeasonalAdjustment,
} from "@prism/spec";

export const Frequency = z.enum([
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "annual",
]);
export type Frequency = z.infer<typeof Frequency>;

export const Geography = z.enum(["US", "US-state", "US-county"]);
export type Geography = z.infer<typeof Geography>;

export const Counterpart = z.object({
  dimension: z.enum(["seasonal_adjustment", "price_basis"]),
  value: z.string().min(1),
  seriesId: z.string().min(1),
  conceptId: z.string().min(1).optional(),
  label: z.string().min(1),
});
export type Counterpart = z.infer<typeof Counterpart>;

export const Concept = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  shortLabel: z.string().min(1),
  agency: Agency,
  distributor: Distributor,
  seriesId: z.string().min(1),
  tableId: z.string().min(1).optional(),
  seasonalAdjustment: SeasonalAdjustment,
  priceKind: PriceKind,
  priceBasis: PriceBasis.optional(),
  frequency: Frequency,
  unit: z.string().min(1),
  geography: Geography,
  aliases: z.array(z.string().min(1)).optional(),
  counterparts: z.array(Counterpart).optional(),
  notes: z.string().min(1),
});
export type Concept = z.infer<typeof Concept>;

export const Catalog = z.object({
  version: z.literal("0.1.0"),
  concepts: z.array(Concept).min(1),
});
export type Catalog = z.infer<typeof Catalog>;
