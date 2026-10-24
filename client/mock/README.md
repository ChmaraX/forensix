# Design mock backend

Design-only. This is **not** analyzer test data and is never wired into
`server/`, `core/`, or `cli/`. It exists so the `client` dashboard can be
designed and iterated against a rich, plausible Case without running a real
ingest/analyse pipeline.

## Run it

```
cd client
npm run build
npm run mock
```

Then open the printed URL (defaults to `http://127.0.0.1:7799/`).

Override the port with `--port`:

```
npm run mock -- --port 7800
```

The mock server reads `dist/index.js` fresh on every request, so re-running
`npm run build` (or `node scripts/dev.mjs`'s watcher output, copied over) is
picked up without restarting `npm run mock`.

### Several builds side by side

To keep parallel builds from overwriting each other, give each one its own
output directory and port:

```
export FORENSIX_CLIENT_OUTDIR=/tmp/my-build   # or: node scripts/build.mjs --outdir /tmp/my-build
node scripts/build.mjs
node mock/server.mjs --port 7812              # serves $FORENSIX_CLIENT_OUTDIR/index.js
node mock/server.mjs --port 7813 --bundle /tmp/other-build/index.js
node scripts/mock-dev.mjs --port 7814 --outdir /tmp/watch-build   # watch mode
```

The defaults are unchanged: `dist/index.js` and port 7799.

## What it serves

- `GET /` — an HTML shell equivalent to the real server's `htmlShell()`
  (sets `window.__FORENSIX_TOKEN__`, loads `/index.js` as a module), with the
  real server's Content-Security-Policy header.
- `GET /index.js` — the built client bundle.
- `GET /api/<route>` for every route the real server exposes: `completeness`,
  `profiles`, `history`, `timeline`, `site-favicons`, `cookies`,
  `credentials`, `top-sites`, `cache`, `favicons`, `candidates`,
  `topic-candidates`, `metadata`, `downloads`, `bookmarks`, `autofill`.

`timeline` merges history visits, downloads, cookie creation, and autofill
last-used rows by timestamp, newest first — mirroring core's
`queryTimeline`. `site-hosts`/`site-findings` are not wired up yet.

The fixture data lives in `case-data.mjs`: one hand-authored case
(`CASE-2024-0417`, an insider-threat/financial-fraud scenario), two Chrome
profiles, both committed and sidecar (WAL/rollback-journal) rows for every
Finding-backed artifact, all four `FieldState` variants in use across the
data, and completeness outcomes covering produced/absent/unavailable.

## Known simplification

Query parameters — search, sort, direction, limit, per-artifact extra
filters, `commit-state` — are accepted but **ignored**. Every route always
returns its full static list. That's enough to design list/detail UI against
realistic data; it is not a stand-in for testing filtering, sorting, or
pagination behavior. The real server (`server/src/index.ts` + `core/`) is the
source of truth for that logic.

No auth/token check is enforced (the token is a fixed constant); this never
leaves localhost and is not part of any shipped artifact.
