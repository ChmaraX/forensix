/**
 * Design-only mock Case data for the ForensiX dashboard client.
 *
 * This is NOT analyzer test data and is never read by core/cli/server. It
 * exists so the client can be designed, iterated and photographed against a
 * rich, plausible Case without a real analyzed one. The scenario (subject,
 * sites, page titles, dated story events) is in scenario.mjs; this file turns
 * it into rows of core's shapes. All people, companies and accounts are
 * fictional.
 *
 * Two Chrome Profiles on a company MacBook: "Default" (the work Profile) and
 * "Profile 1" (personal browsing). Six weeks of browsing, with a four-day
 * gap for a trip, and a cleared last week whose visits, downloads and one
 * favicon survive only in WAL files (recovered rows). The rows keep every
 * Field State in use (value, empty, absent, unavailable) at a realistic rate.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  buildCandidates,
  buildCompleteness,
  buildMetadata,
  buildTopicCandidates,
} from "./case-context-data.mjs";
import {
  CASE_ID,
  DECLARED_TIMEZONE,
  PROFILES,
  PROFILE_DEFAULT,
  PROFILE_SECOND,
  SEALED_REASON,
  SOURCE_IMAGE,
  SOURCE_USER_DATA,
  absent,
  pick,
  prng,
  provenance,
  timestamp,
  unavailable,
  value,
} from "./case-kit.mjs";
import {
  AUTOFILL_ITEMS,
  BOOKMARK_ITEMS,
  CLEARED_AT,
  CLEARED_FROM,
  COOKIE_NAMES,
  DOWNLOADS_DIR,
  DOWNLOAD_ITEMS,
  FICTIONAL_MARKS,
  FIRST_DAY,
  LAST_DAY,
  LOGIN_ITEMS,
  SITES,
  STORY_SEARCH,
  STORY_VISITS,
  TRIP_DAYS,
  siteOf,
} from "./scenario.mjs";

/** True when an instant falls in the cleared window: its rows were removed
 *  from the saved databases and survive only in their WAL files. */
function cleared(iso) {
  return iso >= CLEARED_FROM && iso <= CLEARED_AT;
}

function isoAt(day, minutes) {
  const base = new Date(`${day}T00:00:00.000Z`);
  base.setUTCSeconds(Math.round(minutes * 60));
  return base.toISOString();
}

function addSeconds(iso, seconds) {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}

function daysOfCase() {
  const days = [];
  const day = new Date(`${FIRST_DAY}T00:00:00.000Z`);
  const last = new Date(`${LAST_DAY}T00:00:00.000Z`);
  while (day <= last) {
    days.push(day.toISOString().slice(0, 10));
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return days;
}

function weighted(rand, sites) {
  const total = sites.reduce((sum, site) => sum + site.weight, 0);
  let roll = rand() * total;
  for (const site of sites) {
    roll -= site.weight;
    if (roll < 0) return site;
  }
  return sites[sites.length - 1];
}

/* --------------------------------- History -------------------------------- */

const WORK_SITES = SITES.filter((s) => s.kind === "work" || s.kind === "both");
const PERSONAL_SITES = SITES.filter(
  (s) => s.kind === "personal" || s.kind === "both",
);

/** Core's transition names and the raw core value Chrome stores for each. */
const TRANSITION_RAW = {
  link: 0,
  typed: 1,
  auto_bookmark: 2,
  form_submit: 7,
  reload: 8,
};

/** One browsing session: `count` visits spread over `[from, to)` minutes of
 *  the day, picked from `sites`. */
function session(rand, day, from, to, count, sites, profile) {
  const visits = [];
  for (let i = 0; i < count; i += 1) {
    const site = weighted(rand, sites);
    const [path, title] = pick(rand, site.pages);
    visits.push({
      iso: isoAt(day, from + rand() * (to - from)),
      host: site.host,
      path,
      title,
      profile,
    });
  }
  return visits;
}

function scheduledVisits() {
  const rand = prng(2024);
  const visits = [];
  for (const day of daysOfCase()) {
    if (TRIP_DAYS.includes(day)) continue;
    const weekday = new Date(`${day}T00:00:00.000Z`).getUTCDay();
    const workday = weekday >= 1 && weekday <= 5;
    const between = (low, high) => low + Math.floor(rand() * (high - low + 1));
    if (day === LAST_DAY) {
      // The last morning: Slack, mail and calendar, then the laptop goes back.
      visits.push(
        ...session(
          rand,
          day,
          8 * 60 + 50,
          12 * 60 + 20,
          14,
          WORK_SITES.slice(0, 1).concat(
            siteOf("mail.google.com"),
            siteOf("calendar.google.com"),
          ),
          PROFILE_DEFAULT,
        ),
      );
      continue;
    }
    if (workday) {
      visits.push(
        ...session(
          rand,
          day,
          8 * 60 + 40,
          12 * 60 + 30,
          between(13, 20),
          WORK_SITES,
          PROFILE_DEFAULT,
        ),
        ...session(
          rand,
          day,
          13 * 60 + 20,
          18 * 60 + 15,
          between(14, 22),
          WORK_SITES,
          PROFILE_DEFAULT,
        ),
      );
      if (rand() < 0.75) {
        visits.push(
          ...session(
            rand,
            day,
            19 * 60 + 30,
            23 * 60,
            between(3, 9),
            PERSONAL_SITES,
            rand() < 0.6 ? PROFILE_SECOND : PROFILE_DEFAULT,
          ),
        );
      }
    } else {
      visits.push(
        ...session(
          rand,
          day,
          10 * 60 + 15,
          13 * 60,
          between(3, 8),
          PERSONAL_SITES,
          PROFILE_SECOND,
        ),
        ...session(
          rand,
          day,
          17 * 60,
          23 * 60 + 30,
          between(4, 10),
          PERSONAL_SITES,
          PROFILE_SECOND,
        ),
      );
    }
  }
  for (const [iso, host, pageIndex] of STORY_VISITS) {
    const [path, title] =
      pageIndex < 0 ? STORY_SEARCH : siteOf(host).pages[pageIndex];
    visits.push({ iso, host, path, title, profile: PROFILE_DEFAULT });
  }
  return visits.sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0));
}

function buildHistoryVisits() {
  const rand = prng(101);
  const plan = scheduledVisits();
  const visitCount = new Map();
  const lastVisit = new Map();
  for (const visit of plan) {
    const url = `https://${visit.host}${visit.path}`;
    visitCount.set(url, (visitCount.get(url) ?? 0) + 1);
    lastVisit.set(url, visit.iso);
  }
  const urlIds = new Map();
  let nextUrlId = 4100;
  let visitId = 61_200;
  let previous = null;
  return plan.map((visit, index) => {
    const url = `https://${visit.host}${visit.path}`;
    if (!urlIds.has(url)) urlIds.set(url, nextUrlId++);
    const urlId = urlIds.get(url);
    const sameSession =
      previous !== null &&
      previous.profile === visit.profile &&
      new Date(visit.iso) - new Date(previous.iso) < 20 * 60_000;
    const transition = visit.path.startsWith("/search")
      ? "form_submit"
      : !sameSession
        ? rand() < 0.3
          ? "auto_bookmark"
          : "typed"
        : rand() < 0.05
          ? "reload"
          : "link";
    const commitState = cleared(visit.iso) ? "wal_resident" : "committed";
    const recovered = commitState !== "committed";
    const durationSeconds =
      visit.host === "www.figma.com" || visit.host === "app.slack.com"
        ? 120 + Math.floor(rand() * 1500)
        : 8 + Math.floor(rand() * 420);
    const emptyTitle = visit.host === "www.google.com" && index % 37 === 0;
    const row = {
      recordType: "finding",
      findingKind: "history_visit",
      profile: visit.profile,
      commitState,
      provenance: provenance(
        "visits",
        visitId,
        recovered ? SOURCE_USER_DATA : SOURCE_IMAGE,
      ),
      fields: {
        visitId: value(String(visitId)),
        urlId: value(String(urlId)),
        urlRecordId: value(String(urlId)),
        url: value(url),
        title: value(emptyTitle ? "" : visit.title),
        urlVisitCount: value(String(visitCount.get(url))),
        typedCount: value(
          String(transition === "typed" ? 1 + Math.floor(rand() * 6) : 0),
        ),
        lastVisitTime: timestamp(lastVisit.get(url)),
        hidden: value(false),
        visitTime: timestamp(visit.iso),
        fromVisit: sameSession ? value(String(visitId - 1)) : value("0"),
        externalReferrerUrl:
          index % 97 === 0
            ? unavailable("column not present in this Chrome version")
            : absent(),
        transitionRaw: value(String(TRANSITION_RAW[transition])),
        transitionCore: value(transition),
        transitionQualifiers: value(
          sameSession ? [] : ["chain_start", "chain_end"],
        ),
        redirectFromVisitId: absent(),
        redirectToVisitIds: value([]),
        segmentId: recovered
          ? unavailable("row deleted, recovered from WAL without this field")
          : value(String(300 + (urlId % 40))),
        visitDuration: value(String(durationSeconds * 1_000_000)),
        visitSource:
          index % 151 === 0
            ? unavailable("missing_column")
            : value("SOURCE_BROWSED"),
      },
    };
    visitId += 1;
    previous = visit;
    return row;
  });
}

const HISTORY_VISITS = buildHistoryVisits();

function utcOf(row, field) {
  const state = row.fields[field];
  return state?.state === "value" ? state.value.utc : null;
}

function buildHistoryActivity() {
  // One Finding per Profile per Commit State per local date/hour bucket,
  // aggregated from the visit rows above — mirrors core's `activity` view,
  // which groups by save state too (core/src/history.ts), so saved and
  // recovered visits never share a bucket.
  const buckets = new Map();
  for (const visit of HISTORY_VISITS) {
    const utc = utcOf(visit, "visitTime");
    const date = utc.slice(0, 10);
    const hour = utc.slice(11, 13);
    const key = `${visit.profile}|${visit.commitState}|${date}|${hour}`;
    const bucket = buckets.get(key) ?? {
      profile: visit.profile,
      date,
      hour,
      count: 0,
      durationMicros: 0,
      commitState: visit.commitState,
    };
    bucket.count += 1;
    bucket.durationMicros += Number(visit.fields.visitDuration.value);
    buckets.set(key, bucket);
  }
  return [...buckets.values()].map((bucket, index) => ({
    recordType: "finding",
    findingKind: "history_activity",
    profile: bucket.profile,
    commitState: bucket.commitState,
    provenance: provenance("visits", `activity-${index}`),
    fields: {
      localDate: value(bucket.date),
      localHour: value(bucket.hour),
      declaredTimezone: value(DECLARED_TIMEZONE),
      supportingVisitCount: value(String(bucket.count)),
      visitsWithDurationCount: value(String(bucket.count)),
      visitsWithoutDurationCount: value("0"),
      totalDurationMicros: value(String(bucket.durationMicros)),
    },
  }));
}

function buildHistoryMostVisited() {
  const counts = new Map();
  for (const visit of HISTORY_VISITS) {
    if (visit.commitState !== "committed") continue;
    const url = visit.fields.url.value;
    const entry = counts.get(url) ?? {
      count: 0,
      title: visit.fields.title.value,
    };
    entry.count += 1;
    counts.set(url, entry);
  }
  const ranked = [...counts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 12);
  return ranked.map(([url, entry], index) => ({
    recordType: "finding",
    findingKind: "history_most_visited",
    profile: PROFILE_DEFAULT,
    commitState: "committed",
    provenance: provenance("urls", `most-visited-${index}`),
    fields: {
      url: value(url),
      title: value(entry.title),
      supportingVisitCount: value(String(entry.count)),
    },
  }));
}

/** First and last visit instant per host, from the History rows. */
const HOST_SPAN = (() => {
  const span = new Map();
  for (const visit of HISTORY_VISITS) {
    const host = new URL(visit.fields.url.value).hostname;
    const utc = utcOf(visit, "visitTime");
    const entry = span.get(host) ?? { first: utc, last: utc, count: 0 };
    entry.last = utc;
    entry.count += 1;
    span.set(host, entry);
  }
  return span;
})();

/* -------------------------------- Cookies -------------------------------- */

const SAME_SITE = ["lax", "lax", "no_restriction", "strict"];

function buildCookies() {
  const rand = prng(303);
  const rows = [];
  let cookieId = 70_400;
  for (const [host, names] of Object.entries(COOKIE_NAMES)) {
    const span = HOST_SPAN.get(host);
    if (span === undefined) continue;
    names.forEach((name, i) => {
      const created = addSeconds(span.first, 2 + i);
      const lastAccess = span.last;
      const recent = lastAccess >= CLEARED_FROM;
      const commitState = recent && i === 0 ? "wal_resident" : "committed";
      const decrypted = cookieId % 3 !== 0;
      rows.push({
        recordType: "finding",
        findingKind: "cookie",
        profile:
          siteOf(host).kind === "personal" ? PROFILE_SECOND : PROFILE_DEFAULT,
        commitState,
        provenance: provenance(
          "cookies",
          cookieId,
          commitState === "committed" ? SOURCE_IMAGE : SOURCE_USER_DATA,
        ),
        fields: {
          cookieId: value(String(cookieId)),
          // Chrome records a domain cookie's host key with a leading dot and
          // a host-only cookie's without one.
          hostKey: value(i === 0 ? host : `.${host.replace(/^www\./, "")}`),
          name: value(name),
          path: value("/"),
          topFrameSiteKey: value(""),
          value: decrypted
            ? value(
                createHash("sha256")
                  .update(`${host}/${name}`)
                  .digest("base64url")
                  .slice(0, 32),
              )
            : unavailable(SEALED_REASON),
          isEncrypted: value(true),
          encryptedValueScheme: value("v10"),
          isSecure: value(true),
          isHttpOnly: value(i === 0),
          isPersistent: value(true),
          hasExpires: value(true),
          priority: value("medium"),
          sameSite: value(pick(rand, SAME_SITE)),
          sourceScheme: value("secure"),
          sourcePort: value("443"),
          sourceType: value("http"),
          creationTime: timestamp(created),
          expiresTime: timestamp(addSeconds(created, 400 * 86_400)),
          lastAccessTime: timestamp(lastAccess),
          lastUpdateTime:
            commitState === "committed"
              ? timestamp(lastAccess)
              : unavailable(
                  "row deleted, recovered from WAL without this field",
                ),
        },
      });
      cookieId += 1;
    });
  }
  return rows;
}

/* ------------------------------ Credentials ------------------------------ */

function buildCredentials() {
  return LOGIN_ITEMS.map(
    ([host, loginPath, user, created, lastUsed, timesUsed], i) => {
      const origin = `https://${host}${loginPath}`;
      const commitState = cleared(created) ? "wal_resident" : "committed";
      return {
        recordType: "finding",
        findingKind: "login_credential",
        profile: host === "www.amazon.com" ? PROFILE_SECOND : PROFILE_DEFAULT,
        commitState,
        provenance: provenance(
          "logins",
          210 + i,
          commitState === "committed" ? SOURCE_IMAGE : SOURCE_USER_DATA,
        ),
        fields: {
          credentialId: value(String(210 + i)),
          originUrl: value(origin),
          actionUrl: value(origin),
          signonRealm: value(`https://${host}/`),
          usernameElement: value(user.includes("@") ? "email" : "username"),
          usernameValue: value(user),
          passwordElement: value("password"),
          // Passwords stay encrypted and are never shown, per product rule.
          secret: unavailable(SEALED_REASON),
          secretEncryptionScheme: value("v10"),
          secretByteLength: value(String(32 + ((i * 7) % 24))),
          dateCreated: timestamp(created),
          dateLastUsed: timestamp(lastUsed),
          datePasswordModified:
            i === 4
              ? unavailable("column not present in this Chrome version")
              : timestamp(created),
          timesUsed: value(String(timesUsed)),
          blacklistedByUser: value(false),
          scheme: value("0"),
          displayName: absent(),
          iconUrl: absent(),
          federationUrl: absent(),
          skipZeroClick: value(false),
        },
      };
    },
  );
}

/* -------------------------------- Top sites -------------------------------- */

function buildTopSites() {
  const hosts = [...HOST_SPAN.entries()]
    .filter(([host]) => siteOf(host).kind !== "story")
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([host]) => host);
  return hosts.map((host, i) => {
    const [path, title] = siteOf(host).pages[0];
    return {
      recordType: "finding",
      findingKind: "top_site",
      profile: PROFILE_DEFAULT,
      commitState: "committed",
      provenance: provenance("top_sites", 30 + i, SOURCE_IMAGE),
      fields: {
        topSiteId: value(String(30 + i)),
        url: value(`https://${host}${path}`),
        title: value(title),
        urlRank: value(String(i)),
        redirects: value(""),
      },
    };
  });
}

/* -------------------------------- Downloads -------------------------------- */

function buildDownloads() {
  return DOWNLOAD_ITEMS.map(([start, file, host, mime, bytes, state], i) => {
    const pageUrl = `https://${host}${siteOf(host).pages[0][0]}`;
    const fileUrl = `https://${host}/download/${encodeURIComponent(file)}`;
    const seconds = Math.max(2, Math.round(bytes / 9_000_000));
    const interrupted = state === "interrupted";
    const received = interrupted ? Math.round(bytes * 0.38) : bytes;
    const end = addSeconds(start, interrupted ? seconds * 0.38 : seconds);
    const commitState = cleared(start) ? "wal_resident" : "committed";
    const path = `${DOWNLOADS_DIR}/${file}`;
    return {
      recordType: "finding",
      findingKind: "download",
      profile: PROFILE_DEFAULT,
      commitState,
      provenance: provenance(
        "downloads",
        40 + i,
        commitState === "committed" ? SOURCE_IMAGE : SOURCE_USER_DATA,
      ),
      fields: {
        downloadId: value(String(40 + i)),
        guid: value(
          createHash("sha256")
            .update(`${start}${file}`)
            .digest("hex")
            .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, "$1-$2-$3-$4-$5"),
        ),
        targetPath: value(path),
        currentPath: interrupted ? value(`${path}.crdownload`) : value(path),
        startTime: timestamp(start),
        endTime: interrupted ? absent() : timestamp(end),
        lastAccessTime: interrupted ? absent() : timestamp(end),
        receivedBytes: value(String(received)),
        totalBytes: value(String(bytes)),
        state: value(state),
        dangerType: value("not_dangerous"),
        interruptReason: interrupted ? value("network_failed") : absent(),
        opened: value(mime === "application/pdf"),
        transient: value(false),
        referrer: value(pageUrl),
        siteUrl: value(`https://${host}/`),
        tabUrl: value(pageUrl),
        tabReferrerUrl: absent(),
        httpMethod: value("GET"),
        mimeType: value(mime),
        originalMimeType: value(mime),
        etag:
          i === 2
            ? unavailable("column not present in this Chrome version")
            : absent(),
        lastModified: absent(),
        originalUrl: value(fileUrl),
        finalUrl: value(fileUrl),
        urlChain: value([fileUrl]),
        urlChainLength: value("1"),
      },
    };
  });
}

/* -------------------------------- Bookmarks -------------------------------- */

/** Bookmarks the subject deleted before the image: they survive only in
 *  `Bookmarks.bak`. */
const DELETED_BOOKMARKS = new Set([
  "Lead Product Designer — Lumenworks",
  "WeTransfer",
]);

function buildBookmarks() {
  return BOOKMARK_ITEMS.map(([name, url, folder, added], i) => {
    const backup = DELETED_BOOKMARKS.has(name);
    return {
      recordType: "finding",
      findingKind: "bookmark",
      profile: PROFILE_DEFAULT,
      commitState: "committed",
      provenance: provenance(
        backup ? "Bookmarks.bak" : "Bookmarks",
        120 + i,
        SOURCE_USER_DATA,
      ),
      fields: {
        bookmarkId: value(String(120 + i)),
        guid: value(
          createHash("sha256")
            .update(url)
            .digest("hex")
            .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, "$1-$2-$3-$4-$5"),
        ),
        name: value(name),
        url: value(url),
        dateAdded: timestamp(added),
        dateLastUsed: HOST_SPAN.has(new URL(url).hostname)
          ? timestamp(HOST_SPAN.get(new URL(url).hostname).last)
          : absent(),
        sourceFile: value(backup ? "Bookmarks.bak" : "Bookmarks"),
        rootFolder: value(
          folder.startsWith("Bookmarks Bar") ? "bookmark_bar" : "other",
        ),
        parentFolder: value(folder.split(" / ").pop()),
        folderPath: value(folder, { synthetic: true }),
      },
    };
  });
}

/* -------------------------------- Autofill -------------------------------- */

function buildAutofill() {
  const queryTimes = {
    "figma auto layout wrap": "2024-03-07T10:41:00.000Z",
    "lumenworks lead product designer salary": "2024-03-14T21:20:00.000Z",
    "wetransfer max file size free": "2024-04-11T00:43:00.000Z",
    "clear chrome history mac": "2024-04-12T21:40:00.000Z",
  };
  return AUTOFILL_ITEMS.map(([name, text], i) => {
    const used = queryTimes[text] ?? "2024-04-02T09:15:00.000Z";
    const created = queryTimes[text] ?? "2023-06-12T15:58:00.000Z";
    const commitState = cleared(used) ? "wal_resident" : "committed";
    return {
      recordType: "finding",
      findingKind: "autofill_entry",
      profile: PROFILE_DEFAULT,
      commitState,
      provenance: provenance(
        "autofill",
        500 + i,
        commitState === "committed" ? SOURCE_IMAGE : SOURCE_USER_DATA,
      ),
      fields: {
        autofillId: value(String(500 + i)),
        fieldName: value(name),
        fieldValue: value(text),
        fieldValueLower: value(text.toLowerCase()),
        timesUsed: value(String(name === "q" ? 1 : 3 + (i % 9))),
        dateCreated: timestamp(created),
        dateLastUsed: timestamp(used),
      },
    };
  });
}

/* ---------------------------------- Cache ---------------------------------- */

function buildCache() {
  const rand = prng(909);
  const committed = HISTORY_VISITS.filter((v) => v.profile === PROFILE_DEFAULT);
  const rows = [];
  for (let i = 0; i < 40; i += 1) {
    const visit = committed[Math.floor(rand() * committed.length)];
    const url = visit.fields.url.value;
    const lastUsed = utcOf(visit, "visitTime");
    const hash = createHash("sha1")
      .update(`${url}#${i}`)
      .digest("hex")
      .slice(0, 16);
    const recovered = visit.commitState !== "committed";
    rows.push({
      recordType: "finding",
      findingKind: "cache_entry",
      profile: PROFILE_DEFAULT,
      commitState: recovered ? "wal_resident" : "committed",
      provenance: provenance(
        "simple_cache",
        `entry-${hash}`,
        recovered ? SOURCE_USER_DATA : SOURCE_IMAGE,
      ),
      fields: {
        backend: value("simple"),
        entryHash: value(hash),
        key:
          i === 17
            ? unavailable("value present but not a recognized encoding")
            : value(`1/0/_dk_https://${new URL(url).hostname} ${url}`),
        keyLength: value(String(url.length + 30)),
        // Core writes the cache's integrity flags as "true" / "false".
        keyHashValid: value("true"),
        entryHashMatchesFilename: value("true"),
        keySha256: value(
          createHash("sha256").update(url).digest("hex").slice(0, 16),
        ),
        version: value("8.0"),
        lastUsed: timestamp(lastUsed),
        entrySizeBytes: value(String(2_000 + Math.floor(rand() * 600_000))),
        stream0Size: value(String(180 + Math.floor(rand() * 400))),
        stream1Size: value(String(1_500 + Math.floor(rand() * 580_000))),
      },
    });
  }
  return rows;
}

/* -------------------------------- Favicons -------------------------------- */

/** An SVG mark for a fictional company (no real favicon exists). */
function fictionalMark(host) {
  const mark = FICTIONAL_MARKS[host];
  const shape =
    host === "lumenworks.io"
      ? `<circle cx="32" cy="32" r="13" fill="#fff"/>` +
        Array.from({ length: 8 }, (_, k) => {
          const angle = (k * Math.PI) / 4;
          const x1 = 32 + Math.cos(angle) * 18;
          const y1 = 32 + Math.sin(angle) * 18;
          const x2 = 32 + Math.cos(angle) * 24;
          const y2 = 32 + Math.sin(angle) * 24;
          return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#fff" stroke-width="4" stroke-linecap="round"/>`;
        }).join("")
      : `<rect x="18" y="16" width="8" height="32" rx="2" fill="#fff"/>` +
        `<rect x="38" y="16" width="8" height="32" rx="2" fill="#fff"/>` +
        `<rect x="18" y="29" width="28" height="6" rx="2" fill="#fff"/>`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="14" fill="${mark.fill}"/>${shape}</svg>`;
  return { bytes: Buffer.from(svg, "utf8"), mime: "image/svg+xml" };
}

/** The stored bitmap of a host's favicon: the PNG in `favicons/`, or a mark
 *  drawn for a fictional company. */
function faviconPayload(host) {
  const { bytes, mime } =
    host in FICTIONAL_MARKS
      ? fictionalMark(host)
      : {
          bytes: readFileSync(
            new URL(`./favicons/${host}.png`, import.meta.url),
          ),
          mime: "image/png",
        };
  return {
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    dataUri: `data:${mime};base64,${bytes.toString("base64")}`,
  };
}

function buildFavicons() {
  return SITES.filter((site) => HOST_SPAN.has(site.host)).map((site, i) => {
    const span = HOST_SPAN.get(site.host);
    const payload = faviconPayload(site.host);
    // Clearing history also cleared the private mailbox's icon: it
    // survives only in the WAL.
    const commitState =
      site.host === "mail.proton.me" ? "wal_resident" : "committed";
    return {
      recordType: "finding",
      findingKind: "favicon",
      profile: site.kind === "personal" ? PROFILE_SECOND : PROFILE_DEFAULT,
      commitState,
      provenance: provenance(
        "favicon_bitmaps",
        800 + i,
        commitState === "committed" ? SOURCE_IMAGE : SOURCE_USER_DATA,
      ),
      fields: {
        bitmapId: value(String(800 + i)),
        iconId: value(String(600 + i)),
        iconUrl: value(`https://${site.host}/favicon.ico`),
        iconType: value("favicon"),
        width: value("64"),
        height: value("64"),
        lastUpdated: timestamp(span.first),
        lastRequested: value(""),
        payloadSha256: value(payload.sha256),
        payloadBytes: value(String(payload.bytes.length)),
        payloadPath: value(`favicon-payloads/${payload.sha256}`),
        pageUrls: value(
          site.pages.slice(0, 2).map(([path]) => `https://${site.host}${path}`),
        ),
      },
      // The stored bitmap, for the mock's `site-favicons` and
      // `favicon-bitmaps` routes (stripped from the wire row like every `_`
      // helper field).
      _dataUri: payload.dataUri,
    };
  });
}

/* --------------------------------------------------------------------------
 * Assembled export
 * ------------------------------------------------------------------------ */

const hostCounts = Object.fromEntries(
  [...HOST_SPAN.entries()].map(([host, span]) => [host, span.count]),
);

export const caseData = {
  caseId: CASE_ID,
  profiles: {
    status: "ok",
    command: "profiles",
    caseId: CASE_ID,
    profiles: PROFILES,
  },
  completeness: buildCompleteness(),
  history: {
    visits: HISTORY_VISITS,
    activity: buildHistoryActivity(),
    mostVisited: buildHistoryMostVisited(),
  },
  cookies: buildCookies(),
  credentials: buildCredentials(),
  topSites: buildTopSites(),
  downloads: buildDownloads(),
  bookmarks: buildBookmarks(),
  autofill: buildAutofill(),
  cache: buildCache(),
  favicons: buildFavicons(),
  metadata: buildMetadata(),
  candidates: buildCandidates(hostCounts),
  topicCandidates: buildTopicCandidates(hostCounts),
};
