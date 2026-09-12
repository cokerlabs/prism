import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

type Concept = {
  id: string;
  label: string;
  seriesId: string;
  aliases?: string[];
  agency: string;
  distributor: string;
  tableId?: string;
  seasonalAdjustment: string;
  priceKind: string;
  priceBasis?: string;
  frequency: string;
  unit: string;
  geography: string;
  notes: string;
  counterparts?: Array<{
    dimension: string;
    value: string;
    seriesId: string;
    conceptId?: string;
    label: string;
  }>;
};

type Observation = { date: string; value: number | null };

const here = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(
  readFileSync(
    join(here, "../../packages/catalog/data/concepts.json"),
    "utf8",
  ),
) as { version: string; concepts: Concept[] };

const recorded = {
  CPIAUCSL: JSON.parse(
    readFileSync(join(here, "../../fixtures/series/CPIAUCSL.json"), "utf8"),
  ),
  UNRATE: JSON.parse(
    readFileSync(join(here, "../../fixtures/series/UNRATE.json"), "utf8"),
  ),
  PAYEMS: JSON.parse(
    readFileSync(join(here, "../../fixtures/series/PAYEMS.json"), "utf8"),
  ),
} as Record<
  string,
  {
    observation_start?: string;
    observation_end?: string;
    observations: Array<{ date: string; value: string }>;
  }
>;

function json(res: {
  statusCode: number;
  setHeader: (key: string, value: string) => void;
  end: (body: string) => void;
}, data: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function findConcept(id: string): Concept | undefined {
  const needle = id.toUpperCase();
  return catalog.concepts.find(
    (concept) =>
      concept.id === id ||
      concept.seriesId.toUpperCase() === needle ||
      concept.aliases?.some((alias) => alias.toUpperCase() === needle),
  );
}

function parseObservations(
  rows: Array<{ date: string; value: string }>,
): Observation[] {
  return rows.map((row) => {
    const raw = row.value.trim();
    const parsed = raw === "" || raw === "." ? Number.NaN : Number(raw);
    return {
      date: row.date,
      value: Number.isFinite(parsed) ? parsed : null,
    };
  });
}

function pc1(values: Array<number | null>, periods = 12): Array<number | null> {
  return values.map((value, index) => {
    const prior = values[index - periods];
    if (
      value === null ||
      prior === undefined ||
      prior === null ||
      prior === 0
    ) {
      return null;
    }
    return ((value - prior) / prior) * 100;
  });
}

/** Keep local Vite on the same Access path contract as production. */
function prismPathGate(): Plugin {
  return {
    name: "prism-path-gate",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const path = url.pathname;

        if (path === "/" || path === "") {
          res.statusCode = 404;
          res.setHeader("content-type", "text/plain; charset=utf-8");
          res.end("Not found. Prism is at /in/prism/.");
          return;
        }

        if (path === "/in/prism/api/health") {
          json(res, { ok: true, service: "prism" });
          return;
        }

        if (path === "/in/prism/api/catalog") {
          json(res, { version: catalog.version, concepts: catalog.concepts });
          return;
        }

        const seriesMatch = /^\/in\/prism\/api\/series\/([^/]+)$/.exec(path);
        if (seriesMatch?.[1]) {
          const requestedId = decodeURIComponent(seriesMatch[1]);
          const concept = findConcept(requestedId);
          if (!concept) {
            json(res, { error: "not_found", service: "prism" }, 404);
            return;
          }

          const seasonal = url.searchParams.get("seasonal_adjustment") ?? undefined;
          const priceBasis = url.searchParams.get("price_basis") ?? undefined;
          const transform = url.searchParams.get("transform") ?? "level";
          const vintagePolicy = url.searchParams.get("vintage_policy") ?? "latest";

          if (seasonal && seasonal !== concept.seasonalAdjustment) {
            json(
              res,
              {
                error: "clarify",
                service: "prism",
                reason: "seasonal_adjustment_mismatch",
                message:
                  "This series does not match the requested seasonal adjustment. Prism does not remap SA and NSA.",
                requested: { seasonal_adjustment: seasonal },
                catalog: {
                  conceptId: concept.id,
                  nativeId: concept.seriesId,
                  seasonal_adjustment: concept.seasonalAdjustment,
                  price_basis: concept.priceBasis,
                },
                choices: [
                  {
                    dimension: "seasonal_adjustment",
                    value: concept.seasonalAdjustment,
                    seriesId: concept.seriesId,
                    conceptId: concept.id,
                    label: concept.label,
                  },
                  ...(concept.counterparts ?? [])
                    .filter((item) => item.dimension === "seasonal_adjustment")
                    .map((item) => ({
                      dimension: item.dimension,
                      value: item.value,
                      seriesId: item.seriesId,
                      conceptId: item.conceptId,
                      label: item.label,
                    })),
                ],
              },
              409,
            );
            return;
          }

          if (
            priceBasis &&
            (concept.priceBasis === undefined ||
              concept.priceBasis !== priceBasis)
          ) {
            json(
              res,
              {
                error: "clarify",
                service: "prism",
                reason: "price_basis_mismatch",
                message:
                  concept.priceBasis === undefined
                    ? "This series is not a price series. Prism does not assign a real or nominal basis."
                    : "This series does not match the requested price basis. Prism does not remap real and nominal.",
                requested: { price_basis: priceBasis },
                catalog: {
                  conceptId: concept.id,
                  nativeId: concept.seriesId,
                  seasonal_adjustment: concept.seasonalAdjustment,
                  price_basis: concept.priceBasis,
                },
                choices: [
                  {
                    dimension: "price_basis",
                    value: concept.priceBasis ?? concept.priceKind,
                    seriesId: concept.seriesId,
                    conceptId: concept.id,
                    label: concept.label,
                  },
                  ...(concept.counterparts ?? [])
                    .filter((item) => item.dimension === "price_basis")
                    .map((item) => ({
                      dimension: item.dimension,
                      value: item.value,
                      seriesId: item.seriesId,
                      conceptId: item.conceptId,
                      label: item.label,
                    })),
                ],
              },
              409,
            );
            return;
          }

          const payload = recorded[concept.seriesId];
          if (!payload) {
            json(
              res,
              {
                error: "data_source_unavailable",
                service: "prism",
                message: "Data source unavailable",
              },
              503,
            );
            return;
          }

          let observations = parseObservations(payload.observations);
          if (transform === "pc1") {
            const values = pc1(
              observations.map((row) => row.value),
              concept.frequency === "quarterly" ? 4 : 12,
            );
            observations = observations.map((row, index) => ({
              date: row.date,
              value: values[index] ?? null,
            }));
          }

          json(res, {
            conceptId: concept.id,
            nativeId: concept.seriesId,
            observations,
            provenance: {
              conceptId: concept.id,
              label: concept.label,
              agency: concept.agency,
              distributor: concept.distributor,
              nativeId: concept.seriesId,
              tableId: concept.tableId,
              seasonalAdjustment: concept.seasonalAdjustment,
              priceBasis: concept.priceBasis,
              priceKind: concept.priceKind,
              frequency: concept.frequency,
              unit: concept.unit,
              geography: concept.geography,
              transform,
              vintagePolicy,
              observationStart: payload.observation_start,
              observationEnd: payload.observation_end,
              retrievedAt: new Date().toISOString(),
              observationSource: "recorded",
              sourceUrl: `https://fred.stlouisfed.org/series/${concept.seriesId}`,
              notes: concept.notes,
              requested: {
                conceptId: requestedId,
                seasonal_adjustment: seasonal,
                price_basis: priceBasis,
                transform,
                vintage_policy: vintagePolicy,
              },
            },
          });
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig({
  base: "/in/prism/",
  plugins: [react(), prismPathGate()],
  build: {
    outDir: "dist/in/prism",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    open: "/in/prism/",
  },
  preview: {
    port: 4173,
    open: "/in/prism/",
  },
});
