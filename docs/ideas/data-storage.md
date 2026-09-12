# Ideas: durable data storage + polite poller

**Status:** ideas only. This branch does not implement a poller or change runtime behavior.

**Thesis:** Prism should be a reliable economic-data repository first. Poll upstream slowly, store series in one internal schema, and let generative UI (and every other client) read from that store. The repository has standalone value even if compose never ships.

**Related:** [PR #5](https://github.com/cokerlabs/prism/pull/5) — R1 truthful data path (fetch on demand + memory/KV TTL cache). Schema sketch: [`data-schema.md`](./data-schema.md).

---

## Recommendation

**Use Cloudflare as the warehouse at owner scale.** D1 is the source of truth for catalog bindings, latest observations, and ingest state. A Cron Trigger on the existing Prism Worker polls a curated FRED set through the PR #5 polite client (identifying User-Agent, 1 request / 500 ms, `Retry-After` + jittered backoff). KV holds an API-shaped latest snapshot per series so reads do not walk D1 observation rows. R2 holds the latest raw payload plus a short-retention replay log — not a public FRED dump.

Do **not** introduce Postgres, DuckDB, BigQuery, Snowflake, or an R2-parquet lake for the first 10–50 series. Those products win later (see [When to leave this shape](#when-to-leave-this-shape)). D1 is already bound (`prism` / `DB` in `wrangler.toml`).

**Legal gate before Phase A:** the FRED API terms currently prohibit storing, caching, or archiving FRED content and incorporating it into a database. A durable “full repository” of FRED payloads is not the same thing as R1’s short TTL cache. Read [FRED terms](#fred-terms-and-rate-limits) and decide — contact the St. Louis Fed, keep a TTL-only cache, or treat FRED as a temporary adapter and ingest from original agencies. The schema below is agency-agnostic so that choice is reversible.

### Three tradeoffs

1. **D1 + KV + R2 vs a real warehouse.** D1 is single-threaded, 10 GB max, 30-day Time Travel, 100 bound parameters per statement. For ~50 series and ~200k latest observations that is plenty and stays on the stack we already run. A parquet lake or Postgres is more movable and better at vintage analytics, but it is a new ops surface for a product that is still access-gated under `/in/prism/`. Revisit when the catalog is thousands of series or we keep full ALFRED histories.

2. **Latest-only store vs full vintage warehouse.** R1’s default is `vintage_policy=latest`. Storing only the current vintage matches that, keeps D1 small, and covers almost every UI read. GDP, payrolls, and other revision-heavy series lose “what was known when” unless we also keep ALFRED. Recommendation: latest-only in Phases A–C; `as_of` stays an on-demand FRED/ALFRED fetch (or `501`) until a later vintage table for a short allowlist.

3. **FRED-as-source vs agency-native ingest.** FRED is the convenient distributor for R1 and for the first poller. A repository that must survive FRED ToS, outages, or key revocation should ingest from BLS / BEA / Census / Treasury into the same tables. That is explicitly out of scope for the first poller, but the common schema is the point — do not bake `fred/series/observations` JSON in as the stored document.

---

## Current state (R1)

PR #5 is the baseline this design migrates from. It is not merged to `main` at the time of writing.

| Piece | Behavior |
| --- | --- |
| Live fetch | FRED only. BLS/Census clients exist as stubs; ACS catalog rows are metadata. |
| Etiquette | `User-Agent: Prism/0.1 (+https://cokerlabs.dev/in/prism; respectful bot)`; host policy 1 req / 500 ms on `api.stlouisfed.org`; honor `Retry-After`; exponential backoff + jitter on 429; serial `RateGate`. |
| Cache | In-isolate memory TTL; optional KV `CACHE`. TTL by frequency: daily/weekly ≥ 1 h, monthly ≥ 6 h, quarterly/annual ≥ 12 h. |
| Window | Default last 20 years. |
| API | `GET /in/prism/api/series/:conceptId` with forced enums: `seasonal_adjustment` `SA\|NSA\|NA`, `price_basis` `nominal\|real\|index`, `transform` `level\|pc1`, `vintage_policy` `latest\|as_of`. |
| Resolver | No silent SA/NSA or real/nominal remap (`409` clarify). |
| Provenance | `observationSource`: `live` \| `recorded` \| `cached`. |
| D1 | Bound, unused by the series path. |

The problem: every cache miss hits FRED on the request path. Memory cache dies with the isolate. KV (if bound) is still a TTL cache of request-shaped windows, not a repository. Compose, a second UI, or FRED being down cannot read a store that does not exist.

---

## Architecture

```text
                    Cron Trigger (every 6h + weekday 8:40 ET)
                                    │
                                    ▼
                     ┌──────────────────────────┐
                     │  Prism Worker            │
                     │  scheduled() poller      │
                     │  politeFetch + RateGate  │
                     └────────────┬─────────────┘
                                  │  ≤ 1 req / 500 ms
                                  ▼
                           FRED API (only)
                                  │
              ┌───────────────────┼───────────────────┐
              ▼                   ▼                   ▼
        D1 `prism`           KV `CACHE`            R2 `prism-series`
        series               series:latest:*       latest/fred/{id}.json
        observations_latest  (API-shaped JSON)     raw/fred/{id}/{ts}.json
        ingest_runs                                (30-day retention)
              ▲
              │  source of truth
              │
     GET /in/prism/api/series/:id
              │
              ├─ resolve (catalog enums, no remap)
              ├─ KV latest snapshot
              ├─ D1 fallback
              ├─ apply transform in-process
              └─ provenance: observationSource = "store"
```

Same Worker as today’s static + API process. One isolate per cron invocation, so the in-memory `RateGate` is sufficient for upstream pacing. A D1 row (`ingest_lock`) prevents overlapping crons.

### Why this split

| Store | Role | Why not the other thing |
| --- | --- | --- |
| **D1** | Truth: which series we keep, latest points, watermarks, run history. | KV cannot query “all series stale since T”. R2 cannot do `WHERE concept_id = ?`. |
| **KV** | Hot read of the latest API payload (observations + metadata). | Avoids D1 row-read amplification on daily series (~16k points). Optional in R1 already. |
| **R2** | Latest raw upstream JSON + short replay. | D1 row size is 2 MB; we do not want to store opaque blobs in SQL. R2 is cheap and egress-free. |

R2 parquet is a **later** export format (Phase E, not scheduled), not the serving format. Workers do not want to parse parquet on the request path for a line chart.

### Ingestion schedule

Poll the **curated FRED catalog** only. Do not walk `fred/series/updates` — that endpoint is “every series FRED touched in two weeks” (hundreds of thousands of rows, paginated at 1,000) and is the wrong tool for a 10–50 id allowlist.

| Trigger | Cron (UTC) | Purpose |
| --- | --- | --- |
| Catch-up | `0 */6 * * *` | Kind default. Daily yields lag at most six hours. |
| Release window | `40 13 * * 1-5` | ~8:40 a.m. Eastern during EDT (12:40 UTC in EST). Covers 8:30 a.m. ET BLS/BEA prints. |
| Optional EST twin | `40 12 * * 1-5` | Only if we refuse to be an hour late in winter. Prefer one weekday shot plus the 6-hour grid. |

Cloudflare Cron Triggers: 5 per account on Free, 250 on Paid; **15 minutes wall time** per invocation; Paid CPU up to **15 minutes** on cron ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)). Fifty series at 500 ms spacing is about 30–60 seconds of wall time. Stay on one Worker; do not add Queues or Workflows until the catalog is hundreds of series or a single run cannot finish.

Per series, on each run:

1. `GET fred/series?series_id=` → `last_updated`, units, SA, observation span.
2. If `last_updated` ≤ stored watermark and observations exist → mark unchanged; **do not** pull observations.
3. Else `GET fred/series/observations` for the **full native span** (repository, not the 20-year API default). `file_type=json`. `vintage_policy=latest` (omit realtime params).
4. Upsert D1 `observations_latest` in chunks (D1 allows 100 bound parameters per statement).
5. Write KV `series:latest:{distributor}:{native_id}`.
6. Write R2 `latest/` (overwrite) and `raw/` (timestamped). Delete `raw/` objects older than 30 days.

Backfill (Phase A) is the same loop with watermarks empty, run once from `scheduled()` or `wrangler` with the same polite client. Fifty series × two calls ≈ 100 requests ≈ 50 seconds. Fit in one cron.

### Rate budget

Published FRED throttle ([v2 errors](https://fred.stlouisfed.org/docs/api/fred/v2/errors.html)):

> 429 Too Many Requests (Up to 2 requests per second is allowed before being served with 429 error code. Not complying with the throttling can result in a temporary block.)

The Bank may change limits without notice ([API terms](https://fred.stlouisfed.org/legal/)). Community and older write-ups also cite **120 requests / minute / key**. Prism already paces at **1 request / 500 ms** (2/s ceiling, no burst). Keep that. Do not raise it to “fill the 120/min.”

| Window | Published cap | Prism budget (50 series) | Notes |
| --- | --- | --- | --- |
| 1 second | 2 | 1 | Existing `RateGate`. |
| 1 minute | ~120 (commonly cited) | ≤ 12 | One cron should not exceed this even on backfill. |
| 1 cron | — | ≤ 120 | Meta + observations for 50 ids, worst case. |
| 1 day | unpublished | ≤ 500 | Four 6-hour runs + one weekday release run, most of them meta-only. |

Rules:

- One API key per application (already in the R1 README).
- No parallel FRED hosts. Cron and a rare admin refresh share a D1 lock so they cannot double the rate.
- Request-path live FRED **stops** in Phase C except `as_of` and an explicit admin refresh.
- On 429: existing backoff; if still failing, abort the run, record `ingest_runs.status = partial`, try the next cron. Do not tight-loop.
- No HTML scrape. No undocumented endpoints.

### Revision and vintage

FRED “latest” is ALFRED as of today: revisions overwrite prior values. That is what we persist in `observations_latest`.

| Policy | Store behavior (Phases A–C) | Later |
| --- | --- | --- |
| `latest` | Read `observations_latest` / KV snapshot. Provenance `vintagePolicy=latest`, `retrievedAt` = `series.last_success_at`. | Unchanged. |
| `as_of` | Do not invent a vintage. Either on-demand `fred/series/observations` with `realtime_start=realtime_end=as_of` (R1) or `501` until a vintage table exists. | `observations_vintage` for an allowlist (GDPC1, PAYEMS, …). Source: `fred/series/vintagedates` + observations by vintage. |

Do not store FRED `units` / `frequency` transforms (`pc1` on the wire). Transforms stay in `@prism/transforms` on read, same as R1.

When a poller upserts latest values, previous latest points for that series are replaced. R2 `raw/` from the last 30 days is the only automatic undo besides D1 Time Travel (30 days on Paid).

### Backfill vs incremental

- **Backfill:** empty watermark → fetch metadata + full observation history → write all three stores. Idempotent. Safe to re-run.
- **Incremental:** metadata `last_updated` watermark. FRED does not offer “observations since T” for a given id without vintages. After a change, replace the latest series (one observations call), not a tail patch. Daily series are still one JSON payload.
- **Do not** incremental-patch by `observation_end` only. Benchmark revisions change history, not just the last point.

### How the API / UI reads

Phase C contract, same URL as R1:

`GET /in/prism/api/series/:conceptId` + existing query enums.

1. Resolver (unchanged): catalog native id, refuse silent remaps.
2. If distributor ≠ `FRED` → `503` data source unavailable (unchanged).
3. Load **store** (KV, else D1). Do not call FRED.
4. Slice `observation_start` / `observation_end` in process. Default window can remain 20 years for the response even though the store keeps full history.
5. Apply `level` / `pc1`.
6. Provenance: `observationSource: "store"` (new enum value). Echo agency, distributor, native id, SA, price basis, unit, `sourceUrl`, notes, `last_updated` from FRED, `last_success_at`. Required attribution: source agency + “via FRED” (see terms).

UI (Phase D) keeps using that route. Add a freshness line from `last_success_at` / `last_updated_upstream`. Product copy stays Prism language; this doc is internal and technical.

Health: extend `/in/prism/api/health` (or add `/in/prism/api/ingest`) with last run status and age. Access-gated like everything else.

---

## FRED terms and rate limits

Sources: [FRED legal](https://fred.stlouisfed.org/legal/), [API errors](https://fred.stlouisfed.org/docs/api/fred/errors.html), [v2 errors](https://fred.stlouisfed.org/docs/api/fred/v2/errors.html), [observations](https://fred.stlouisfed.org/docs/api/fred/series_observations.html), [realtime periods](https://fred.stlouisfed.org/docs/api/fred/realtime_period.html), [vintage dates](https://fred.stlouisfed.org/docs/api/fred/series_vintagedates.html), [series/updates](https://fred.stlouisfed.org/docs/api/fred/series_updates.html).

**Be kind (already decided, keep):**

- Official API only. No scrape, no mirroring of the FRED site.
- Identifying User-Agent. Do not cloak the app ([API prohibition (b)](https://fred.stlouisfed.org/legal/)).
- ≤ ~2 req/s; 429 → `Retry-After` / backoff; one key.
- Attribution on every view. Suggested form: `Source: BLS via FRED` (or BEA / Treasury / Census). Keep third-party copyright notices from series notes.
- Required notice if we ship a FRED-backed app: *“This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.”*
- Do not use `FRED` / `ALFRED` / `Federal Reserve Bank` in a hostname.
- Do not imply St. Louis Fed endorsement.
- Curated subset only. Do not “take all the data on FRED and claim it is a unique product.”
- Skip series whose notes mark third-party copyright that requires pre-approval (Case-Shiller, Visa SMI, and similar). The first 10–50 should be public-domain or “citation required” agency series already in the catalog.

**Legal gate — API prohibition (l)** ([full terms](https://fred.stlouisfed.org/legal/)):

> Use the FRED® API in connection with storing, caching, or archiving any portion of the FRED® Services or FRED® Content; providing any stored, cached, or archived portion … to any third party; or incorporating any FRED® Content in any database, compilation, archive, cache, or other medium.

**API prohibition (k)** bars using the API to **develop or train** ML / generative systems. Inference-time compose that *charts* official series is a different question from building a training corpus. Do not dump FRED series into fine-tunes or eval datasets. Confirm compose-with-numbers separately.

The FAQ still says you may “create an app using a subset of FRED data through the free API,” and the summarized terms encourage apps — then point at the additional API terms. Those additional terms are stricter than a TTL cache.

**Decision required before Phase A implementation:**

| Option | Meaning |
| --- | --- |
| **A. Ask St. Louis Fed** | Email `stlsFRED@stls.frb.org` (or the contact they specify): access-gated app, curated 10–50 official series, private D1, attribution, no redistribution, no training. Best if we want FRED as the durable source. |
| **B. Stay TTL-only** | Keep PR #5 cache semantics (hours, not years). Cron may *refresh* the cache so the request path stays cold, but we do not advertise a multi-year repository of FRED content. Weaker thesis, safer ToS fit. |
| **C. Agency-native warehouse** | Common schema now; first durable ingest from BLS/BEA/Census/Treasury (later). FRED remains R1’s convenience path only. Strongest long-term repository; more adapters. |

This ideas PR assumes **A or C** for the thesis (“full data repository”). **B** is the fallback if A is refused and C is not staffed. Do not ship a public data dump or an open `/api/series` without Access.

---

## Cloudflare product limits (relevant)

| Product | Limit that matters | Fit |
| --- | --- | --- |
| **D1** ([limits](https://developers.cloudflare.com/d1/platform/limits/)) | 10 GB/db (Paid), 500 MB (Free); 2 MB/row; 100 bound params; 30 s query; 1000 queries/invocation Paid; **single-threaded**; Time Travel 30 days Paid. | Latest observations for 50 series ≪ 1 GB. Chunk writes. Do not run heavy analytics here. |
| **Workers / Cron** ([limits](https://developers.cloudflare.com/workers/platform/limits/), [pricing](https://developers.cloudflare.com/workers/platform/pricing/)) | Cron wall 15 min; Paid cron CPU up to 15 min; 6 simultaneous outbound connections; 10k subrequests Paid. | One polite serial poller is connection-1 and well under time. |
| **KV** | 25 MiB/value; eventual consistency; Paid 10M reads + 1M writes included. | Latest JSON per series is hundreds of KB. Writes = poll successes only. |
| **R2** | Objects to 5 TB; 10 GB-month free storage class; Class A/B ops. | Tiny. 30-day raw + latest. |
| **Cron count** | 5 Free / 250 Paid per **account**. | Two expressions is fine; do not explode into per-series crons. |

D1 concurrency: one database, one thread. Poller writes and API reads share it. That is why KV is the read path.

---

## Cost and ops (owner scale)

Assume **Workers Paid** ($5/month) — D1 production + cron CPU headroom. Incremental storage/compute for this design should stay inside the included allotments.

### Size model

| Item | 10 series | 50 series |
| --- | --- | --- |
| Latest observation rows | ~30k (mix) | ~200k (10 daily + 35 monthly + 5 quarterly, full history) |
| D1 bytes (rows + indexes) | ~10 MB | ~50 MB |
| KV keys | 10 | 50 |
| KV bytes | ~2 MB | ~10 MB |
| R2 latest + 30 raw days | ~5 MB | ~30 MB |

Full-history daily Treasury-style series dominate. CPI/UNRATE monthly since 1948 is ~900 points and does not move the needle.

### Monthly $ (order of magnitude)

| Line | Included on Paid | Our use | Extra $ |
| --- | --- | --- | --- |
| Workers subscription | $5 | already needed for a serious Worker | $5 if not already Paid |
| Worker requests + CPU | 10M req, 30M CPU-ms | UI + 5 cron/day | ~$0 |
| D1 reads | 25B rows | KV-first; D1 fallback rare | ~$0 |
| D1 writes | 50M rows | ~200k upserts on a bad day; typically meta-only | ~$0 |
| D1 storage | 5 GB | ≪ 5 GB | $0 |
| KV | 10M reads, 1M writes, 1 GB | tens of reads/day | $0 |
| R2 | 10 GB, 1M Class A, 10M Class B | tiny | $0 |
| FRED | free key | < 500 req/day | $0 |

**Ballpark: $0 incremental on an existing Paid account; $5/month if this is what forces Paid.** Not a warehouse invoice.

If we mistakenly `SELECT *` from D1 on every daily-series chart: 16k rows × 10k views/month ≈ 160M row reads — still inside 25B. KV is for latency and D1 lock contention, not for the invoice.

### Ops

- **One lock, one run log.** `ingest_runs` + `GET` ingest health. Alert = last success older than 18 hours or `status=failed`.
- **Re-run:** empty a watermark or delete KV key; next cron backfills that id.
- **Restore:** D1 Time Travel (30 days) or R2 `raw/`.
- **Secrets:** `FRED_API_KEY` only. No new vendors.
- **Local:** fixtures stay the source of truth for tests. Poller tests use recorded FRED JSON (PR #5 `fixtures/series/`).
- **Access:** poller and API stay on `/in/prism*`. No `workers_dev`. Cron does not need a public URL.

---

## Migration from R1 (PR #5)

Do not flip the request path in the same PR as the first poller.

| Step | What changes | What stays |
| --- | --- | --- |
| **0. Land R1** | Live FRED + polite client + resolver + `/api/series`. | Memory/KV TTL cache. |
| **1. Schema** | D1 migrations from [`data-schema.md`](./data-schema.md). Bind R2. Bind KV for real (today it is commented). | No read-path change. |
| **2. Phase A backfill** | One locked run over the curated FRED set. Fill D1 + KV + R2. | API still live + TTL cache. Compare store vs live in a hidden admin or fixture test. |
| **3. Phase B cron** | `scheduled()` + 6-hour / release crons. Watermarks. Ingest health. | API still live + TTL. Cache key can start preferring store-shaped payloads. |
| **4. Dual read** | Flag `SERIES_READ=live\|store\|auto`. `auto` = store if `last_success_at` is fresh (e.g. < 26 h), else live. Provenance tells the truth. | Rollback = flip flag. |
| **5. Phase C** | Default `store`. Request-path FRED only for `as_of` and admin refresh. Extend `observationSource` with `store`. | Resolver, transforms, 409 clarify. |
| **6. Phase D** | UI freshness + attribution string. Remove “fetching live…” copy. | Same route. |
| **7. Retire TTL cache** | Memory/KV TTL for *live* windows goes away. KV becomes poller-written latest only. | Fixtures / `recorded` for tests. |

Compatibility:

- Keep `/in/prism/api/series/:conceptId` query params.
- Keep 409 clarify and 503 unavailable.
- Add `store` to `observationSource`; do not silently relabel store hits as `cached`.
- Default 20-year response window can remain; the store may hold more.

---

## Phased plan

### Phase A — Backfill the curated set

- D1 schema + R2 bucket + KV namespace.
- Allowlist = current catalog FRED rows (CPIAUCSL, CPILFESL, UNRATE, PAYEMS, CES0500000003, GDPC1, FEDFUNDS, HOUST, DGS10, PCEPI, …) plus counterparts we already declare. Grow toward 50 only after the legal gate.
- One polite backfill. Full native history. Latest vintage only.
- Verify counts and last values against PR #5 fixtures / a live pull.
- **Legal gate must be resolved (A/B/C above) before this writes durable FRED content.**

### Phase B — Cron poll

- `0 */6 * * *` and weekday 8:40 ET.
- Metadata watermark; observations only when `last_updated` moves.
- `ingest_runs` + lock. Health surface.
- API still serves live+TTL so a bad poller cannot break R1.

### Phase C — Serve the API from the store

- `SERIES_READ` default `store`.
- Transforms and resolver unchanged.
- `as_of` explicit (live or 501).
- Provenance `observationSource: "store"`.

### Phase D — UI

- Catalog / series UI reads the same API.
- Show freshness and agency-via-FRED attribution.
- No request-path spinner that implies a live FRED round trip.

**After D (not in this plan):** BLS/Census adapters; vintage table for GDP/payrolls; R2 parquet export; agency-native as source of record.

---

## Non-goals

- Implementing the poller, migrations, or bindings on this branch.
- Merging this ideas work to `main`.
- BLS, Census, BEA, or Treasury live ingest (catalog metadata only).
- Full ALFRED / every vintage for every series.
- Mirroring FRED, GeoFRED, or “all series updated this week.”
- Scraping HTML, widgets, or unofficial endpoints.
- Public redistribution, open data dump, or Ungating `/in/prism/api`.
- Training or fine-tuning models on FRED content.
- LLM compose (still out of repo scope).
- Maps, geospatial, county/state panels as a storage problem.
- Storing derived transforms (`pc1`, deflated wages) as first-class series.
- Sub-second or release-second freshness. Six hours is polite; 8:40 ET is “quick enough.”
- Per-user databases, multi-tenant D1, or read replication.
- Python, notebooks, or an external warehouse in Phases A–D.
- Durable Objects, Queues, or Workflows for the first poller.
- Changing Access, hostnames, or `workers_dev`.

---

## When to leave this shape

Stay on D1 + KV + R2 until one of these is true:

- Curated set is **thousands** of series, or we keep **full vintage histories** for many of them (D1 size and single-thread writes hurt).
- We need warehouse SQL (joins across vintages, regressions, bulk parquet for research) more than we need an edge `GET /series`.
- FRED cannot be the source and agency APIs prefer bulk files that want a disk/VM.

Then the honest move is **R2 parquet (Hive-style `distributor/native_id/vintage=latest/`)** plus either **DuckDB/MotherDuck** or a small **Postgres**. The internal observation schema in [`data-schema.md`](./data-schema.md) should still be the logical model — only the physical engine changes. Do not invent a second catalog.

---

## Open questions

1. Legal path: A (ask FRED), B (TTL-only), or C (agency-native)? **Blocks Phase A.**
2. Is Workers Paid already on the Coker Labs account? Affects cron CPU and D1 size, not the design.
3. Bind KV for real in the R1 follow-up, or wait for Phase A?
4. `as_of` in Phase C: keep live ALFRED, or return 501 until a vintage table exists?
5. Store full history vs store 20 years? Recommendation: full history in D1 (still small); 20-year default on the API.
6. Release-window cron: one 8:40 ET shot (EDT-biased) or a pair for EST/EDT?
