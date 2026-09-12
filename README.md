# Prism

Coker Labs — generative UI for economic data.

Prism composes views from a curated catalog of official series (FRED, BLS, ACS). The point is to liberate knowledge from bad UI: ask a question, get a chart you can defend. Sources, transforms, and caveats are part of the view, not a footnote.

## Access

Prism is reachable **only** under existing Cloudflare Access applications:

| Host | Path |
| --- | --- |
| `cokerlabs.dev` (primary) | `/in/prism/` |
| `justincoker.com` (optional) | `/in/prism/` |

Those Access applications cover `justincoker.com/in*` and `cokerlabs.dev/in*`. Access is configured at the edge, outside this repository. This Worker does not implement login, sessions, or identity checks.

Do not attach a Worker custom domain at the unprotected root. Do not route `cokerlabs.dev/` or `justincoker.com/` to this Worker. `workers_dev` is disabled so a public `*.workers.dev` hostname is not published.

The UI is built with Vite `base: /in/prism/` and assets nested at `dist/in/prism/`. The Worker returns 404 for `/`. There is no marketing page at the root.

### Public access

To make Prism public, change the Cloudflare Access application (or its path) in the dashboard. Do not add a public site at `/` or attach this Worker to a bare hostname.

## Layout

```
wrangler.toml
apps/web/            UI, served at /in/prism/
apps/worker/         Worker: static + /in/prism/api/*
apps/worker/src/clients/  FRED, BLS, Census
packages/spec/       Zod ViewSpec + series types
packages/catalog/    Curated concepts
packages/resolver/   Concept → native id (no silent remap)
packages/transforms/ level, pc1, and related pure functions
fixtures/series/     Recorded FRED / BLS / ACS payloads
fixtures/prompts/    Golden prompts
```

## Local development

Requires Node 22 and [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm dev            # Vite UI at http://localhost:5173/in/prism/
```

`http://localhost:5173/` returns 404. The Vite dev server serves `/in/prism/api/*`. Recorded fixtures cover CPIAUCSL, UNRATE, and PAYEMS when `FRED_API_KEY` is not set. Live FRED is used when that key is present in the environment.

Production-shaped local (static assets + Worker):

```bash
pnpm build
pnpm dev:worker     # wrangler; health at http://localhost:8787/in/prism/api/health
```

```bash
pnpm typecheck
pnpm test
pnpm build
```

## API

All routes live under `/in/prism/api/`.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/in/prism/api/health` | `{ "ok": true, "service": "prism" }` |
| GET | `/in/prism/api/catalog` | Curated concepts |
| GET | `/in/prism/api/series/:conceptId` | Observations + provenance echo |

Series query parameters: `seasonal_adjustment` (`SA` \| `NSA` \| `NA`), `price_basis` (`nominal` \| `real` \| `index`), `transform` (`level` \| `pc1`), `vintage_policy` (`latest` \| `as_of`), `as_of`, `observation_start`, `observation_end`.

If a requested seasonal adjustment or price basis does not match the concept, the route returns `409` with structured clarify choices. Prism does not remap SA/NSA or real/nominal. Missing agency keys return `503` with `{ "message": "Data source unavailable" }`.

## Deploy

Primary host: **cokerlabs.dev/in/prism/**.

1. D1 `prism` (`binding = "DB"`) and `account_id` are set in `wrangler.toml`.
2. Routes are attached **only** under Access-covered `/in/prism*` (not a custom domain on `/`):

   `cokerlabs.dev/in/prism*`  and `justincoker.com/in/prism*`

3. Confirm Cloudflare Access still covers `/in*` on that hostname.
4. Deploy with Cloudflare Git integration on this repo, or `pnpm deploy` via Wrangler (needs `CLOUDFLARE_API_TOKEN` / account).

`workers_dev` stays off. Do not attach this Worker at the unprotected root.

## Secrets

Agency pulls read Worker secrets. They are optional at build time. Series routes return **Data source unavailable** when the needed binding is missing.

```bash
wrangler secret put FRED_API_KEY
wrangler secret put BLS_API_KEY
wrangler secret put CENSUS_API_KEY
```

| Binding | Used for |
| --- | --- |
| `FRED_API_KEY` | FRED series pull |
| `BLS_API_KEY` | BLS public API |
| `CENSUS_API_KEY` | ACS / Census |
| `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` | Compose (unused) |

For local Wrangler, copy `.dev.vars.example` to `.dev.vars` (not committed).

## Current scope

This repository does not include LLM compose, application auth, maps, or Python.
