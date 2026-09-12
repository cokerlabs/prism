import { useEffect, useMemo, useState } from "react";
import "./App.css";

type Concept = {
  id: string;
  label: string;
  shortLabel: string;
  agency: string;
  distributor: string;
  seriesId: string;
  tableId?: string;
  seasonalAdjustment: string;
  priceKind: string;
  priceBasis?: string;
  frequency: string;
  unit: string;
  notes: string;
};

type Observation = { date: string; value: number | null };

type Provenance = {
  conceptId: string;
  label: string;
  agency: string;
  distributor: string;
  nativeId: string;
  tableId?: string;
  seasonalAdjustment: string;
  priceBasis?: string;
  priceKind: string;
  frequency: string;
  unit: string;
  transform: string;
  vintagePolicy: string;
  asOf?: string;
  observationStart?: string;
  observationEnd?: string;
  retrievedAt: string;
  observationSource: "live" | "recorded";
  sourceUrl: string;
  notes: string;
  requested: Record<string, string | undefined>;
};

type ClarifyChoice = {
  dimension: string;
  value: string;
  seriesId: string;
  conceptId?: string;
  label: string;
};

type SeriesOk = {
  conceptId: string;
  nativeId: string;
  observations: Observation[];
  provenance: Provenance;
};

type SeriesClarify = {
  error: "clarify";
  reason: string;
  message: string;
  choices: ClarifyChoice[];
};

type SeriesUnavailable = {
  error: "data_source_unavailable";
  message: string;
};

type TransformChoice = "level" | "pc1";

const api = (path: string) => `${import.meta.env.BASE_URL}api/${path}`;

function formatValue(value: number | null): string {
  if (value === null) {
    return "—";
  }
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 3,
  }).format(value);
}

export function App() {
  const [health, setHealth] = useState<"checking" | "ok" | "unavailable">(
    "checking",
  );
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [transform, setTransform] = useState<TransformChoice>("level");
  const [series, setSeries] = useState<SeriesOk>();
  const [clarify, setClarify] = useState<SeriesClarify>();
  const [unavailable, setUnavailable] = useState<string>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(api("health")).then((response) =>
        response.ok ? response.json() : Promise.reject(),
      ),
      fetch(api("catalog")).then((response) =>
        response.ok ? response.json() : Promise.reject(),
      ),
    ])
      .then(([healthBody, catalogBody]) => {
        if (cancelled) {
          return;
        }
        if (healthBody.ok && healthBody.service === "prism") {
          setHealth("ok");
        } else {
          setHealth("unavailable");
        }
        const next = catalogBody.concepts as Concept[];
        setConcepts(next);
        setSelectedId((current) => current ?? next[0]?.id);
      })
      .catch(() => {
        if (!cancelled) {
          setHealth("unavailable");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setClarify(undefined);
    setUnavailable(undefined);
    const params = new URLSearchParams({ transform });
    fetch(api(`series/${encodeURIComponent(selectedId)}?${params}`))
      .then(async (response) => {
        const body = await response.json();
        if (cancelled) {
          return;
        }
        if (response.status === 409 && body.error === "clarify") {
          setSeries(undefined);
          setClarify(body as SeriesClarify);
          return;
        }
        if (response.status === 503) {
          setSeries(undefined);
          setUnavailable(
            (body as SeriesUnavailable).message ?? "Data source unavailable",
          );
          return;
        }
        if (!response.ok) {
          setSeries(undefined);
          setUnavailable("Data source unavailable");
          return;
        }
        setSeries(body as SeriesOk);
      })
      .catch(() => {
        if (!cancelled) {
          setSeries(undefined);
          setUnavailable("Data source unavailable");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, transform]);

  const recent = useMemo(() => {
    if (!series) {
      return [];
    }
    return series.observations.slice(-12).reverse();
  }, [series]);

  return (
    <div className="shell">
      <header className="top">
        <div className="brand">
          <span className="wordmark">Prism</span>
          <span className="rule" aria-hidden="true" />
          <span className="kicker">Coker Labs</span>
        </div>
        <p className="status" data-state={health}>
          {health === "checking"
            ? "connecting"
            : health === "ok"
              ? "online"
              : "offline"}
        </p>
      </header>

      <main className="stage">
        <section className="panel catalog" aria-labelledby="catalog-heading">
          <div className="panel-head">
            <h1 id="catalog-heading">Catalog</h1>
            <p>
              Curated official series. Each concept is locked to a native id,
              seasonal adjustment, and price basis.
            </p>
          </div>
          <fieldset className="transform">
            <legend>Transform</legend>
            <label>
              <input
                type="radio"
                name="transform"
                checked={transform === "level"}
                onChange={() => setTransform("level")}
              />
              Level
            </label>
            <label>
              <input
                type="radio"
                name="transform"
                checked={transform === "pc1"}
                onChange={() => setTransform("pc1")}
              />
              Year-over-year
            </label>
          </fieldset>
          <ul className="concept-list">
            {concepts.map((concept) => (
              <li key={concept.id}>
                <button
                  type="button"
                  className={concept.id === selectedId ? "active" : undefined}
                  onClick={() => setSelectedId(concept.id)}
                >
                  <span className="concept-label">{concept.label}</span>
                  <span className="concept-meta">
                    {concept.seriesId}
                    <span aria-hidden="true"> · </span>
                    {concept.seasonalAdjustment}
                    {concept.priceBasis ? ` · ${concept.priceBasis}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel provenance" aria-labelledby="provenance-heading">
          <div className="panel-head">
            <h2 id="provenance-heading">Provenance</h2>
            <p>
              Sources, native ids, and transforms sit with the observations —
              not in a footnote.
            </p>
          </div>

          {loading && !series && !clarify && !unavailable ? (
            <p className="quiet">Loading series…</p>
          ) : null}

          {unavailable ? (
            <div className="notice">
              <p className="notice-title">Data source unavailable</p>
              <p>{unavailable}</p>
            </div>
          ) : null}

          {clarify ? (
            <div className="notice">
              <p className="notice-title">Clarify</p>
              <p>{clarify.message}</p>
              <ul className="choices">
                {clarify.choices.map((choice) => (
                  <li key={`${choice.dimension}-${choice.seriesId}`}>
                    {choice.label} ({choice.seriesId}, {choice.value})
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {series ? (
            <>
              <dl className="facts">
                <div>
                  <dt>Series</dt>
                  <dd>{series.provenance.label}</dd>
                </div>
                <div>
                  <dt>Native id</dt>
                  <dd>
                    <a href={series.provenance.sourceUrl}>
                      {series.provenance.nativeId}
                    </a>
                  </dd>
                </div>
                <div>
                  <dt>Agency</dt>
                  <dd>
                    {series.provenance.agency}
                    <span aria-hidden="true"> · </span>
                    {series.provenance.distributor}
                  </dd>
                </div>
                <div>
                  <dt>Seasonal adjustment</dt>
                  <dd>{series.provenance.seasonalAdjustment}</dd>
                </div>
                <div>
                  <dt>Price basis</dt>
                  <dd>{series.provenance.priceBasis ?? "—"}</dd>
                </div>
                <div>
                  <dt>Transform</dt>
                  <dd>
                    {series.provenance.transform === "pc1"
                      ? "pc1 (year-over-year %)"
                      : "level"}
                  </dd>
                </div>
                <div>
                  <dt>Vintage</dt>
                  <dd>
                    {series.provenance.vintagePolicy}
                    {series.provenance.asOf
                      ? ` · ${series.provenance.asOf}`
                      : ""}
                  </dd>
                </div>
                <div>
                  <dt>Retrieved</dt>
                  <dd>
                    {series.provenance.retrievedAt}
                    {series.provenance.observationSource === "recorded"
                      ? " · recorded"
                      : ""}
                  </dd>
                </div>
              </dl>
              <p className="notes">{series.provenance.notes}</p>
              <table className="readings">
                <caption>Recent observations</caption>
                <thead>
                  <tr>
                    <th scope="col">Period</th>
                    <th scope="col">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((row) => (
                    <tr key={row.date}>
                      <td>{row.date}</td>
                      <td>{formatValue(row.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
        </section>
      </main>

      <footer className="foot">
        <span>cokerlabs.dev/in/prism</span>
      </footer>
    </div>
  );
}
