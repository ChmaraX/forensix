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

- `GET /` - an HTML shell equivalent to the real server's `htmlShell()`
  (sets `window.__FORENSIX_TOKEN__`, loads `/index.js` as a module), with the
  real server's Content-Security-Policy header.
- `GET /index.js` - the built client bundle.
- `GET /api/<route>` for every route the real server exposes: `completeness`,
  `profiles`, `history`, `timeline`, `site-favicons`, `cookies`,
  `credentials`, `top-sites`, `cache`, `favicons`, `candidates`,
  `topic-candidates`, `metadata`, `downloads`, `bookmarks`, `autofill` -
  plus the Sites page's `site-hosts` and `site-findings`.

`timeline` merges history visits, downloads, cookie creation, and autofill
last-used rows by timestamp, newest first - mirroring core's
`queryTimeline`.

`site-hosts` groups history visits, cookies, saved logins, bookmarks, and top
sites by a normalized host key (lowercased, no leading dots or `www.`), with
per-kind counts (`counts`, every Commit State, and `savedCounts`, committed
rows only), honoring `search`, in host-name order like core's
`querySiteHosts`. `site-findings?host=` returns every row for one host, each
tagged with its `artifactKind`. Both page like every list route.

The fixture data lives in `case-data.mjs`: one hand-authored case
(`CASE-2024-0417`, an insider-threat/financial-fraud scenario), two Chrome
profiles, both committed and sidecar (WAL/rollback-journal) rows for every
Finding-backed artifact, all four `FieldState` variants in use across the
data, and completeness outcomes covering produced/absent/unavailable.

### Degraded coverage

The healthy fixture reads every database it serves rows for; its one gap is
a genuine absence (no Form data database in the Guest profile). To design
the coverage banner and the unread states, open the dashboard as
`http://127.0.0.1:<port>/?degraded=1` (that tab only - the page URL rides
each API call's Referer), or start the mock with `--degraded` /
`FORENSIX_MOCK_DEGRADED=1` (every tab). Either way `completeness` also
reports History missing in the second Profile and Cookies and Cache
unreadable ("Database locked."), and the data routes agree with it: a
database that was not read serves no rows - its own route, the Timeline
and the Sites routes all drop them, so an unreadable artifact's page shows
its empty state under the banner.

## Route contracts and the known simplification

The mock enforces the real routes' validation, so a request the real server
rejects is rejected here first, with the real 400 body (`{"status": "error",
"code", "message", "details"}`):

- `limit` - an integer from 1 through 100 (default 50); anything else is a
  400 `INVALID_ARGUMENT` (core's `normalizeLimit` wording).
- Pagination - every list returns at most `limit` rows and a `nextCursor`
  while rows remain; `after=<cursor>` reads the next page. A cursor is bound
  to its query (route and every parameter but `limit` / `after`): reusing it
  after a filter, sort or range changed is a 400 `INVALID_CURSOR`, as on the
  real server.
- `sort` / `direction` - checked against core's allowed values per route
  (and per History `view`); `view` must be `visits`, `activity`,
  `most-visited` or `durations`; `record-type` on `cache` must be `finding`
  or `candidate`.
- `commit-state` (`committed`, `wal_resident`, `journal_resident`) - applied
  on exactly the routes the real server filters by it (`history`, `cookies`,
  `credentials`, `top-sites`, `favicons`, `topic-candidates`, `metadata`,
  `downloads`, `bookmarks`, `autofill`); any other value is a 400. `cache`
  and `timeline` ignore it, as the real server does.
- `from` / `to` - full ISO 8601 instants with an offset, `from` not after
  `to`; applied on the History `visits` view and the `timeline`. On any
  other History view they (and `transition`) are a 400.
- `site-findings` without a `host` is a 400; an unknown route is a 400
  "Unknown dashboard route.".

The simplification: search, the sort order itself and the per-artifact
extra filters are not applied - rows come in the fixture's own order. That's
enough to design list/detail UI against realistic data; it is not a
stand-in for testing filtering or ordering. The real server
(`server/src/index.ts` + `core/`) is the source of truth for that logic.

No auth/token check is enforced (the token is a fixed constant); this never
leaves localhost and is not part of any shipped artifact.
