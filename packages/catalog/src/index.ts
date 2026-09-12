import catalogJson from "../data/concepts.json";
import { Catalog, type Concept } from "./schema";

export { Catalog, Concept, Frequency, Geography } from "./schema";

export const catalog = Catalog.parse(catalogJson);

export function listConcepts(): Concept[] {
  return catalog.concepts;
}

export function getConcept(id: string): Concept | undefined {
  return catalog.concepts.find((concept) => concept.id === id);
}

export function getConceptBySeriesId(seriesId: string): Concept | undefined {
  const needle = seriesId.toUpperCase();
  return catalog.concepts.find(
    (concept) =>
      concept.seriesId.toUpperCase() === needle ||
      concept.aliases?.some((alias) => alias.toUpperCase() === needle),
  );
}
