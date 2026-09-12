# Prism

Coker Labs — generative UI for economic data.

Prism composes views from a curated catalog of official series (FRED, BLS, ACS). The point is to liberate knowledge from bad UI: ask a question, get a chart you can defend. Sources, transforms, and caveats are part of the view, not a footnote.

This repository is the Prism Worker and UI. Agency fetches, compose, and application-level auth live outside this codebase. Access is enforced at the Cloudflare edge.

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
apps/worker/         Worker entry: static + /in/prism/api/*
packages/spec/       Zod ViewSpec
packages/catalog/    Curated series (FRED / BLS / ACS)
packages/transforms/ Pure transforms
fixtures/prompts/    Golden prompts
```

## Local development

Requires Node 22 and [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm dev            # Vite UI at http://localhost:5173/in/prism/
```

`http://localhost:5173/` returns 404. The Vite dev server handles `GET /in/prism/api/health`.

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

## Deploy

Primary host: **cokerlabs.dev/in/prism/**.

1. D1 `prism` (`binding = "DB"`) and `account_id` are set in `wrangler.toml`.
2. Routes are attached **only** under Access-covered `/in/prism*` (not a custom domain on `/`):

   `cokerlabs.dev/in/prism*`  and `justincoker.com/in/prism*`

3. Confirm Cloudflare Access still covers `/in*` on that hostname.
4. Deploy with Cloudflare Git integration on this repo, or `pnpm deploy` via Wrangler (needs `CLOUDFLARE_API_TOKEN` / account).

`workers_dev` stays off. Do not attach this Worker at the unprotected root.

## Secrets

| Binding | Used for |
| --- | --- |
| `FRED_API_KEY` | FRED series pull |
| `BLS_API_KEY` | BLS public API |
| `CENSUS_API_KEY` | ACS / Census |
| `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` | Compose |

KV is reserved for cache. No keys are required to run the current Worker. `/in/prism/api/health` returns `{ "ok": true, "service": "prism" }`.

## Current scope

This repository does not include live FRED/BLS/ACS fetch, LLM compose, application auth, maps, or Python.
