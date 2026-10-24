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
per-kind counts, honoring `search`. `site-findings?host=` returns every row
for one host, each tagged with its `artifactKind`. The real server does not
wire these two routes yet (see `server/src/index.ts`), so against a real Case
the Sites page shows its "could not be loaded" state; the mock serves them so
the page can be designed.

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

## Known simplification

Three query parameters are honored:

- `limit` - the first `limit` rows (the Overview's fixed-height cards rely
  on it). `nextCursor` is always `null`, so there is never a second page.
- `commit-state` (`committed`, `wal_resident`, `journal_resident`) - on
  exactly the routes the real server filters by it (`history`, `cookies`,
  `credentials`, `top-sites`, `favicons`, `topic-candidates`, `metadata`,
  `downloads`, `bookmarks`, `autofill`); any other value is a 400
  `INVALID_ARGUMENT`, as on the real server. `cache` and `timeline` ignore
  it, as the real server does. This is what lets the client's
  saved / recovered split (`useCommitStateLists`) read each Commit State as
  its own query.
- `from` / `to` (ISO instants) - on the History `visits` view and the
  `timeline`, so a date range picked on History, Timeline or Overview
  narrows their lists here too.

Every other parameter - search, sort, direction, per-artifact extra
filters - is accepted but **ignored**; those routes return their full static
list. That's enough to design list/detail UI against
realistic data; it is not a stand-in for testing filtering, sorting, or
pagination behavior. The real server (`server/src/index.ts` + `core/`) is the
source of truth for that logic.

No auth/token check is enforced (the token is a fixed constant); this never
leaves localhost and is not part of any shipped artifact.
