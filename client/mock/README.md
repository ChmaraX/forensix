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
  `profiles`, `history`, `timeline`, `site-hosts`, `site-findings`,
  `site-favicons`, `favicon-bitmaps`, `cookies`, `credentials`, `top-sites`,
  `cache`, `favicons`, `candidates`, `topic-candidates`, `metadata`,
  `downloads`, `bookmarks`, `autofill`.

`timeline` merges history visits, downloads, cookie creation, and autofill
last-used rows by timestamp, newest first - mirroring core's
`queryTimeline`.

The Sites routes follow core exactly by importing core's own host module
(`core/src/site-host-key.ts`, run by Node's type stripping): which fields put
a row on a host (`SITE_HOST_FIELDS`) and how a host is keyed (`siteHostKey`)
are core's, never a copy. `site-hosts` groups visits, cookies, saved logins,
bookmarks, top sites, downloads, cache entries and favicons by host, with
per-kind `counts` (every Commit State) and `savedCounts` (committed rows
only), a row on several hosts counting on each, honoring `search`, in
host-name order. `site-findings?host=` returns every row for one host, each
with its `artifactKind` and `hostFields`. Both page like every list route.
`site-favicons?host=` answers the widest saved bitmap per host (recovered
rows never decorate a host); `favicon-bitmaps?sha256=` answers a favicon
row's own stored bitmap by the hash it records, any Commit State.

Timestamps are core's `ForensicTimestamp` (`raw`, `epochFamily`, `utc`,
`declaredTimezone`, `resolution`), all in the mock Case's declared timezone.

The scenario lives in `scenario.mjs`: the subject, every site with its
page titles, and the dated story events. `case-data.mjs` turns it into rows
of core's shapes (with its shared builders in `case-kit.mjs` and the
metadata, Candidates and Completeness data in `case-context-data.mjs`).

The Case (`CASE-2024-0416`) is a departing-employee investigation. Olivia
Bennett, a product designer at Halden, accepts an offer from Lumenworks
(both companies are fictional). The Case holds six weeks of browsing in two
Chrome Profiles (work and personal), with a four-day trip in the middle. In
her last week she downloads design files, customer research and a customer
export late at night, sends them through WeTransfer and Dropbox, and clears
her history. The cleared visits, downloads, a cookie, a saved login and a
favicon survive only in WAL files, so they show as recovered rows. Two
deleted bookmarks survive in `Bookmarks.bak`. Every Field State is in use
(value, empty, absent, unavailable), and the Completeness Statement has one
genuine absence (the personal Profile has no Web Data database).

Favicons of public sites are 64x64 PNGs in `favicons/`, fetched once from
the sites' own icons. They belong to their owners and are used here only to
illustrate the dashboard. The fictional companies get an SVG mark drawn in
`case-data.mjs`.

### README screenshots

`npm run screenshots` (after `npm run build`) starts the mock and writes
`docs/media/overview.png` and `docs/media/sites.png` at 1440x900, scale 2.

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

- Order - the History `visits` view, `cookies`, `credentials` and
  `favicons` are sorted by `sort` / `direction` (stable; rows without the
  value last), and the `timeline`
  follows `direction`, so those lists read in the order their toolbars say.

The simplification: search, the sort order on the other routes and the
per-artifact extra filters are not applied - those rows come in the
fixture's own order. That's
enough to design list/detail UI against realistic data; it is not a
stand-in for testing filtering or ordering. The real server
(`server/src/index.ts` + `core/`) is the source of truth for that logic.

No auth/token check is enforced (the token is a fixed constant); this never
leaves localhost and is not part of any shipped artifact.
