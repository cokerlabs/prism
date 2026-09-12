import { z } from "zod";

/** First locked ViewSpec version. Bump the literal when the shape changes. */
export const ViewSpecVersion = z.literal("0.1.0");
export type ViewSpecVersion = z.infer<typeof ViewSpecVersion>;

export const Agency = z.enum([
  "BLS",
  "BEA",
  "Census",
  "Federal Reserve",
  "Treasury",
]);
export type Agency = z.infer<typeof Agency>;

export const Distributor = z.enum(["FRED", "BLS", "ACS", "BEA"]);
export type Distributor = z.infer<typeof Distributor>;

export const SeasonalAdjustment = z.enum(["SA", "NSA", "NA"]);
export type SeasonalAdjustment = z.infer<typeof SeasonalAdjustment>;

export const PriceKind = z.enum(["nominal", "real", "index", "rate", "count"]);
export type PriceKind = z.infer<typeof PriceKind>;

export const PriceBasis = z.enum(["nominal", "real", "index"]);
export type PriceBasis = z.infer<typeof PriceBasis>;

export const VintagePolicy = z.enum(["latest", "as_of"]);
export type VintagePolicy = z.infer<typeof VintagePolicy>;

export const SeriesTransform = z.enum([
  "level",
  "pc1",
  "yoy",
  "mom",
  "deflate",
  "index",
]);
export type SeriesTransform = z.infer<typeof SeriesTransform>;

export const ObservationTransform = z.enum(["level", "pc1"]);
export type ObservationTransform = z.infer<typeof ObservationTransform>;

export const SeriesBinding = z.object({
  conceptId: z.string().min(1),
  label: z.string().min(1),
  transform: SeriesTransform,
  deflatorConceptId: z.string().min(1).optional(),
  role: z.enum(["primary", "compare", "deflator"]).optional(),
});
export type SeriesBinding = z.infer<typeof SeriesBinding>;

export const LineChart = z.object({
  type: z.literal("LineChart"),
  title: z.string().min(1),
  subtitle: z.string().optional(),
  series: z.array(SeriesBinding).min(1),
  x: z.object({
    kind: z.literal("time"),
    frequency: z.enum(["daily", "weekly", "monthly", "quarterly", "annual"]).optional(),
  }),
  y: z.object({
    label: z.string().min(1),
    unit: z.string().min(1),
    scale: z.enum(["linear", "log"]),
  }),
});
export type LineChart = z.infer<typeof LineChart>;

export const SmallMultiples = z.object({
  type: z.literal("SmallMultiples"),
  title: z.string().min(1),
  facetBy: z.string().min(1),
  series: z.array(SeriesBinding).min(1),
  columns: z.number().int().positive().optional(),
});
export type SmallMultiples = z.infer<typeof SmallMultiples>;

export const StatTable = z.object({
  type: z.literal("StatTable"),
  title: z.string().min(1),
  columns: z
    .array(
      z.object({
        key: z.string().min(1),
        label: z.string().min(1),
        format: z.enum(["number", "percent", "index", "text"]),
      }),
    )
    .min(1),
  rows: z.array(
    z.object({
      conceptId: z.string().min(1),
      cells: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
    }),
  ),
});
export type StatTable = z.infer<typeof StatTable>;

export const Annotation = z.object({
  type: z.literal("Annotation"),
  text: z.string().min(1),
  tone: z.enum(["note", "warning", "caveat"]),
  anchor: z.string().optional(),
});
export type Annotation = z.infer<typeof Annotation>;

export const ProvenanceBlock = z.object({
  type: z.literal("ProvenanceBlock"),
  showSources: z.boolean(),
  showTransforms: z.boolean(),
  showCaveats: z.boolean(),
});
export type ProvenanceBlock = z.infer<typeof ProvenanceBlock>;

export const Primitive = z.discriminatedUnion("type", [
  LineChart,
  SmallMultiples,
  StatTable,
  Annotation,
  ProvenanceBlock,
]);
export type Primitive = z.infer<typeof Primitive>;

export const PrimitiveNode = z.object({
  kind: z.literal("primitive"),
  id: z.string().min(1),
  primitive: Primitive,
});
export type PrimitiveNode = z.infer<typeof PrimitiveNode>;

export type LayoutNode =
  | PrimitiveNode
  | {
      kind: "stack";
      id: string;
      direction: "row" | "column";
      children: LayoutNode[];
    };

export const LayoutNode: z.ZodType<LayoutNode> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    PrimitiveNode,
    z.object({
      kind: z.literal("stack"),
      id: z.string().min(1),
      direction: z.enum(["row", "column"]),
      children: z.array(LayoutNode).min(1),
    }),
  ]),
);

export const ProvenanceSource = z.object({
  agency: Agency,
  distributor: Distributor.optional(),
  seriesIds: z.array(z.string().min(1)).min(1),
  retrievedAt: z.string().optional(),
  url: z.string().url().optional(),
  notes: z.string().optional(),
});
export type ProvenanceSource = z.infer<typeof ProvenanceSource>;

export const ProvenanceTransform = z.object({
  name: z.string().min(1),
  args: z.record(z.string(), z.unknown()).optional(),
});
export type ProvenanceTransform = z.infer<typeof ProvenanceTransform>;

export const Provenance = z.object({
  prompt: z.string().min(1),
  composedAt: z.string().min(1),
  model: z.string().optional(),
  sources: z.array(ProvenanceSource).min(1),
  transforms: z.array(ProvenanceTransform),
  caveats: z.array(z.string()),
});
export type Provenance = z.infer<typeof Provenance>;

export const ViewSpec = z.object({
  version: ViewSpecVersion,
  id: z.string().min(1),
  title: z.string().min(1),
  subtitle: z.string().optional(),
  provenance: Provenance,
  layout: LayoutNode,
});
export type ViewSpec = z.infer<typeof ViewSpec>;

export function parseViewSpec(data: unknown): ViewSpec {
  return ViewSpec.parse(data);
}
