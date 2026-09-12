# Prism

Coker Labs Project 1 — generative UI for economic data.

Prism composes views from a curated catalog of official series (FRED, BLS, ACS). The point is to liberate knowledge from bad UI: ask a question, get a chart you can defend. Sources, transforms, and caveats are part of the view, not a footnote.

This repo is the scaffold. No live agency fetch, no LLM compose, no auth in app code.

## Access

Prism is reachable **only** under existing Cloudflare Access apps:

| Host | Path |
| --- | --- |
| `cokerlabs.dev` (primary) | `/in/prism/` |
| `justincoker.com` (optional) | `/in/prism/` |

Those Access apps already cover `justincoker.com/in*` and `cokerlabs.dev/in*`. Access is **edge-configured outside this repo**. This Worker must not implement login, sessions, or identity checks.

**Never attach a Worker custom domain at the unprotected root.** Do not route `cokerlabs.dev/` or `justincoker.com/` to this Worker. `workers_dev` is off so a public `*.workers.dev` hostname is not published.

The UI is built with Vite `base: /in/prism/` and assets nested at `dist/in/prism/`. The Worker 404s `/`. There is no marketing page at the root.

### Un-gating later

To make Prism public, change the Cloudflare Access application (or its path) in the dashboard. Do not “un-gate” by adding a public site at `/` or by attaching this Worker to a bare hostname.

## Layout

```
wrangler.toml
apps/web/            UI, served at /in/prism/
apps/worker/         Worker entry: static + /in/prism/api/*
packages/spec/       Zod ViewSpec
packages/catalog/    Curated series stub (FRED / BLS / ACS)
packages/transforms/ Pure transform stubs
fixtures/prompts/    Placeholder golden prompts
```

## Local development

Requires Node 22 and [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm dev            # Vite UI at http://localhost:5173/in/prism/
```

`http://localhost:5173/` is 404 by design. The Vite dev server stubs `GET /in/prism/api/health`.

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

1. Create D1 (`wrangler d1 create prism`) and paste the id into `wrangler.toml`.
2. Attach a **route**, not a custom domain on `/`:

   `cokerlabs.dev/in/prism*`  (and optionally `justincoker.com/in/prism*`)

3. Confirm Cloudflare Access still covers `/in*` on that hostname.
4. Deploy with Cloudflare Git integration on this repo, or `pnpm deploy` via Wrangler (needs `CLOUDFLARE_API_TOKEN` / account).

Commented route notes live in `wrangler.toml`. Leave them commented until the Access path is verified.

## Secrets (later — do not add yet)

| Binding | Used for |
| --- | --- |
| `FRED_API_KEY` | FRED series pull |
| `BLS_API_KEY` | BLS public API |
| `CENSUS_API_KEY` | ACS / Census |
| `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` | Compose (undecided) |

KV comes later for cache. No keys are required for this scaffold. `/in/prism/api/health` returns `{ "ok": true, "service": "prism" }`.

## Out of scope (this scaffold)

Real FRED/BLS/ACS fetch, LLM compose, auth code, maps, Python.
