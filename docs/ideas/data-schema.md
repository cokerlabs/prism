# Ideas: internal series schema

**Status:** sketch for the ideas PR. Not a migration. Do not `d1 execute` this as-is without a real implementer pass (indexes, batching, naming).

Logical model for the durable store described in [`data-storage.md`](./data-storage.md). Physical target for Phases A–D: **D1 + KV + R2**. The row shapes should survive a later move to Postgres or parquet.

Enums match the R1 catalog / spec (`SA|NSA|NA`, `nominal|real|index`, `level|pc1`, `latest|as_of`) plus existing `priceKind` / `frequency` / `geography`.

---

## Identifiers

| Field | Rule |
| --- | --- |
| `concept_id` | Prism catalog id (`cpi-u-all-items`). Stable in product language. |
| `distributor` | `FRED` \| `BLS` \| `ACS` \| `BEA` (spec `Distributor`). First poller: `FRED` only. |
| `native_id` | Upstream series id (`CPIAUCSL`). |
| `series_pk` | `${distributor}:${native_id}` e.g. `FRED:CPIAUCSL`. Primary key for stored series. A concept may point at one native id; counterparts are separate `series_pk` rows. |
| `period` | Observation date as `YYYY-MM-DD` (FRED’s `date`). Monthly/quarterly use the period start FRED returns. |
| `vintage_as_of` | `latest` for the current table. Future vintage table uses a `YYYY-MM-DD` realtime date. |

Do not use FRED’s numeric popularity, category trees, or release ids as Prism keys.

---

## D1 tables

```sql
-- Sketch only. Implement as numbered migrations in a later PR.

CREATE TABLE series (
  series_pk TEXT PRIMARY KEY,              -- FRED:CPIAUCSL
  concept_id TEXT NOT NULL,                -- catalog id; empty string if counterpart-only
  distributor TEXT NOT NULL,               -- FRED | BLS | ACS | BEA
  native_id TEXT NOT NULL,
  agency TEXT NOT NULL,                    -- BLS | BEA | Census | Federal Reserve | Treasury
  label TEXT NOT NULL,
  short_label TEXT NOT NULL,
  seasonal_adjustment TEXT NOT NULL,       -- SA | NSA | NA
  price_kind TEXT NOT NULL,                -- nominal | real | index | rate | count
  price_basis TEXT,                        -- nominal | real | index | NULL
  frequency TEXT NOT NULL,                 -- daily | weekly | monthly | quarterly | annual
  unit TEXT NOT NULL,                      -- catalog unit string
  geography TEXT NOT NULL,                 -- US | US-state | US-county
  source_url TEXT NOT NULL,                -- https://fred.stlouisfed.org/series/CPIAUCSL
  notes TEXT NOT NULL,                     -- catalog notes + copyright line
  copyright_class TEXT,                    -- public_domain | citation_required | preapproval | unknown
  last_updated_upstream TEXT,              -- FRED last_updated, as returned
  observation_start TEXT,                  -- native span
  observation_end TEXT,
  last_polled_at TEXT,                     -- ISO-8601
  last_success_at TEXT,
  last_error TEXT,
  watermark TEXT,                          -- last_updated we have fully stored
  UNIQUE (distributor, native_id)
);

CREATE INDEX series_concept_id ON series (concept_id);
CREATE INDEX series_watermark ON series (watermark);

-- Current vintage only. One row per period per series.
CREATE TABLE observations_latest (
  series_pk TEXT NOT NULL,
  period TEXT NOT NULL,                    -- YYYY-MM-DD
  value REAL,                              -- NULL if FRED sent "." or blank
  realtime_start TEXT,                     -- FRED observation realtime_start if present
  realtime_end TEXT,
  ingested_at TEXT NOT NULL,
  PRIMARY KEY (series_pk, period),
  FOREIGN KEY (series_pk) REFERENCES series (series_pk)
);

CREATE INDEX observations_latest_period ON observations_latest (series_pk, period);

-- Future (not Phase A). Do not create until as_of is stored.
-- CREATE TABLE observations_vintage (
--   series_pk TEXT NOT NULL,
--   period TEXT NOT NULL,
--   vintage_as_of TEXT NOT NULL,          -- ALFRED vintage date
--   value REAL,
--   ingested_at TEXT NOT NULL,
--   PRIMARY KEY (series_pk, period, vintage_as_of)
-- );

CREATE TABLE ingest_runs (
  id TEXT PRIMARY KEY,                     -- uuid
  started_at TEXT NOT NULL,
  finished_at TEXT,
  trigger TEXT NOT NULL,                   -- cron | backfill | admin
  cron_expr TEXT,
  status TEXT NOT NULL,                    -- running | ok | partial | failed
  series_attempted INTEGER NOT NULL DEFAULT 0,
  series_updated INTEGER NOT NULL DEFAULT 0,
  series_unchanged INTEGER NOT NULL DEFAULT 0,
  series_failed INTEGER NOT NULL DEFAULT 0,
  requests_made INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);

CREATE TABLE ingest_run_series (
  run_id TEXT NOT NULL,
  series_pk TEXT NOT NULL,
  status TEXT NOT NULL,                    -- updated | unchanged | failed | skipped
  requests INTEGER NOT NULL DEFAULT 0,
  last_updated_upstream TEXT,
  error TEXT,
  PRIMARY KEY (run_id, series_pk),
  FOREIGN KEY (run_id) REFERENCES ingest_runs (id)
);

-- Single-row lock. UPDATE … WHERE locked_until < now OR owner = me.
CREATE TABLE ingest_lock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  owner TEXT,
  locked_until TEXT,
  run_id TEXT
);

INSERT INTO ingest_lock (id, owner, locked_until, run_id) VALUES (1, NULL, NULL, NULL);
```

### Write notes

- D1: **100 bound parameters** per statement. Upsert observations in chunks of ~30 (`series_pk`, `period`, `value` …).
- Replace a series by deleting `observations_latest` for that `series_pk` then inserting, **or** `INSERT … ON CONFLICT DO UPDATE`. Prefer one transaction/`db.batch()` per series so readers never see a half write.
- Do not update 200k rows in one statement (D1 migration guidance: batch ~1,000).
- `value` is native **level** only. No `pc1` on write.
- FRED missing observations (`"."`) → SQL `NULL` → JSON `null` on read (R1 already does this).

### Read notes

- API default: `SELECT period, value FROM observations_latest WHERE series_pk = ? AND period >= ? ORDER BY period` — **fallback only**.
- Happy path: KV snapshot (below), which already has the array.
- Slice the 20-year default window in the Worker, not by deleting history.

---

## KV

Namespace: the R1 `CACHE` binding, or a dedicated `SERIES` binding if we want TTL cache and store snapshots not to collide.

| Key | Value | Lifetime |
| --- | --- | --- |
| `series:latest:{distributor}:{native_id}` | `StoredSeriesSnapshot` JSON | No TTL. Overwritten by the poller. |
| `ingest:last` | `{ runId, status, finishedAt }` | Overwritten each run. Optional; D1 is truth. |

R1 cache keys today are `source|nativeId|start|end|vintage|asOf` with a TTL. After Phase C those keys go away. Do not mix shapes.

### `StoredSeriesSnapshot`

Align with R1 `FetchedSeries` + provenance fields so `loadSeries` can switch source with a small adapter.

```json
{
  "schemaVersion": "0.1.0",
  "seriesPk": "FRED:CPIAUCSL",
  "conceptId": "cpi-u-all-items",
  "distributor": "FRED",
  "nativeId": "CPIAUCSL",
  "agency": "BLS",
  "label": "CPI-U: all items",
  "seasonalAdjustment": "SA",
  "priceKind": "index",
  "priceBasis": "index",
  "frequency": "monthly",
  "unit": "index_1982_1984_100",
  "geography": "US",
  "sourceUrl": "https://fred.stlouisfed.org/series/CPIAUCSL",
  "notes": "…",
  "lastUpdatedUpstream": "2026-09-11 07:38:02-05",
  "lastSuccessAt": "2026-09-12T13:40:02.000Z",
  "observationStart": "1947-01-01",
  "observationEnd": "2026-08-01",
  "vintagePolicy": "latest",
  "observations": [
    { "date": "1947-01-01", "value": 21.48 },
    { "date": "1947-02-01", "value": 21.62 }
  ]
}
```

KV value limit is 25 MiB. A daily series with ~16k `{date,value}` pairs is well under 1 MiB.

---

## R2

Bucket (suggested): `prism-series`. Private. Access only from the Worker.

```text
latest/{distributor}/{native_id}.json     # same body as KV snapshot, or raw upstream
raw/{distributor}/{native_id}/{iso}.json  # upstream payload as received (30-day lifecycle)
# later:
# vintages/{distributor}/{native_id}/{as_of}.json
# export/parquet/distributor=FRED/native_id=CPIAUCSL/vintage=latest/part-0.parquet
```

- `raw/` is for replay and debugging. Prefer **not** to treat long-lived raw FRED JSON as the product archive if ToS option C (agency-native) wins — keep 30 days, then delete.
- Object writes are poller-only. The API does not read R2 on the hot path.
- Lifecycle: delete `raw/**` after 30 days (R2 lifecycle rule or cron sweeper).

---

## Catalog mapping

`packages/catalog/data/concepts.json` remains the **curated allowlist** and the source of labels, notes, counterparts, and forced enums. D1 `series` is a **materialized** copy plus ingest watermarks.

On each successful poll:

1. Trust catalog for `seasonal_adjustment`, `price_basis` / `price_kind`, `unit`, `geography`.
2. Record FRED’s `seasonal_adjustment_short`, `units`, `frequency_short` in `notes` or a sidecar if they disagree — **do not silently remap**. A mismatch is an ingest warning, same spirit as the resolver’s `409`.
3. Counterparts (`CPIAUCNS`, `UNRATENSA`, …) are separate `series_pk` rows. Backfill them if the catalog declares them; do not invent them.

ACS / BLS-direct rows stay out of `observations_latest` until those adapters exist.

---

## Provenance echo (API)

Extend R1 `ProvenanceEcho.observationSource`:

```text
"live" | "recorded" | "cached" | "store"
```

| Value | Meaning |
| --- | --- |
| `live` | This request called FRED (R1 default; Phase C only `as_of` / admin). |
| `recorded` | Test fixture. |
| `cached` | R1 TTL cache of a live pull. Retire after Phase C. |
| `store` | D1/KV latest snapshot from the poller. |

Always include `sourceUrl`, agency, distributor, native id, `lastSuccessAt`, and an attribution string suitable for the UI (`Source: BLS via FRED`). Do not imply St. Louis Fed endorsement.

---

## First curated FRED set (from today’s catalog)

These are the Phase A allowlist unless the legal review drops one for copyright class.

| concept_id | native_id | agency | frequency | SA | notes |
| --- | --- | --- | --- | --- | --- |
| cpi-u-all-items | CPIAUCSL | BLS | monthly | SA | NSA counterpart CPIAUCNS |
| cpi-u-core | CPILFESL | BLS | monthly | SA | |
| unemployment-rate | UNRATE | BLS | monthly | SA | NSA UNRATENSA |
| nonfarm-payrolls | PAYEMS | BLS | monthly | SA | revisions / benchmarks |
| ahe-private | CES0500000003 | BLS | monthly | SA | nominal; deflate on read |
| real-gdp | GDPC1 | BEA | quarterly | SA | vintage-sensitive |
| fed-funds | FEDFUNDS | Federal Reserve | monthly | NSA | |
| housing-starts | HOUST | Census | monthly | SA | |
| treasury-10y | DGS10 | Treasury | daily | NSA | largest row count |
| pce-price-index | PCEPI | BEA | monthly | SA | |

ACS concepts (`B19013`, `B23025`) are **not** ingested.

Grow toward 10–50 by adding catalog rows first, then the next poller run. No automatic “popular FRED series” crawl.

---

## Out of this sketch

- ViewSpec / compose tables.
- User-saved charts.
- Derived series tables (`pc1`, real AHE).
- Geo / county facts.
- Parquet DDL (commented path on R2 only).
