/**
 * Design-only mock Case data for the ForensiX dashboard client.
 *
 * This is NOT analyzer test data and is never read by core/cli/server. It
 * exists purely so the client can be designed and iterated against a rich,
 * plausible dataset without a real analyzed Case. All names, emails, hosts,
 * and IDs below are fictional.
 *
 * Scenario: a corporate insider-threat / financial-fraud investigation into
 * a former employee's Chrome usage across two profiles ("Default" and
 * "Profile 2") on a company-issued laptop, acquired from a full-disk image.
 */

import { createHash } from "node:crypto";

import {
  buildCandidates,
  buildCompleteness,
  buildMetadata,
  buildTopicCandidates,
} from "./case-context-data.mjs";
import {
  ALL_HOSTS,
  CASE_ID,
  DECLARED_TIMEZONE,
  PROFILES,
  PROFILE_DEFAULT,
  PROFILE_SECOND,
  SEALED_REASON,
  SOURCE_IMAGE,
  SOURCE_USER_DATA,
  absent,
  isoAtSeeded,
  pick,
  prng,
  provenance,
  reasonFor,
  timestamp,
  titleFor,
  unavailable,
  urlFor,
  value,
} from "./case-kit.mjs";

/* --------------------------------- History -------------------------------- */

const TRANSITIONS = ["link", "typed", "auto_bookmark", "reload", "form_submit"];

function buildHistoryVisits() {
  const rand = prng(101);
  const rows = [];
  let visitId = 500100;
  let urlId = 900200;
  for (let i = 0; i < 34; i += 1) {
    const profile = i % 5 === 0 ? PROFILE_SECOND : PROFILE_DEFAULT;
    const host = pick(rand, ALL_HOSTS);
    const url = urlFor(rand, host);
    const title = titleFor(host);
    const daysAgo = Math.floor(rand() * 45);
    const hour = Math.floor(rand() * 24);
    const minute = Math.floor(rand() * 60);
    const visitTimeIso = isoAtSeeded(rand, daysAgo, hour, minute);
    const sidecar = i % 6 === 0 || i % 6 === 1;
    const commitState =
      i % 6 === 0
        ? "wal_resident"
        : i % 6 === 1
          ? "journal_resident"
          : "committed";
    const withDuration = i % 3 !== 2;
    const fields = {
      visitId: value(String(visitId)),
      urlId: value(String(urlId)),
      urlRecordId: value(String(urlId)),
      url: value(url),
      title: i % 11 === 0 ? { state: "value", value: "" } : value(title),
      urlVisitCount: value(String(1 + Math.floor(rand() * 40))),
      typedCount: value(String(Math.floor(rand() * 5))),
      lastVisitTime: timestamp(visitTimeIso),
      hidden: value(false),
      visitTime: timestamp(visitTimeIso),
      fromVisit: i > 0 && i % 4 === 0 ? value(String(visitId - 1)) : absent(),
      externalReferrerUrl: i % 9 === 0 ? unavailable(reasonFor(i)) : absent(),
      transitionRaw: value(String(805306368 + i)),
      transitionCore: value(pick(rand, TRANSITIONS)),
      transitionQualifiers: value(i % 4 === 0 ? ["client_redirect"] : []),
      redirectFromVisitId: absent(),
      redirectToVisitIds: value([]),
      segmentId: sidecar
        ? unavailable("row deleted, recovered from WAL without this field")
        : absent(),
      visitDuration: withDuration
        ? value(String(15_000_000 + Math.floor(rand() * 900_000_000)), {
            synthetic: false,
          })
        : absent(),
      visitSource:
        i % 7 === 0 ? unavailable("missing_column") : value("SOURCE_BROWSED"),
    };
    rows.push({
      recordType: "finding",
      findingKind: "history_visit",
      profile,
      commitState,
      provenance: provenance(
        sidecar ? "visits" : "visits",
        visitId,
        sidecar ? SOURCE_USER_DATA : SOURCE_IMAGE,
      ),
      fields,
      _sortTime: visitTimeIso,
      _sortUrl: url,
      _sortDuration: withDuration ? 1 : 0,
    });
    visitId += 1;
    urlId += 1;
  }
  return rows;
}

const HISTORY_VISITS = buildHistoryVisits();

function buildHistoryActivity() {
  // One Finding per Profile per Commit State per local date/hour bucket,
  // aggregated from the visit rows above — mirrors core's `activity` view,
  // which groups by save state too (core/src/history.ts), so saved and
  // recovered visits never share a bucket.
  const buckets = new Map();
  for (const visit of HISTORY_VISITS) {
    const dt = new Date(visit._sortTime);
    const date = dt.toISOString().slice(0, 10);
    const hour = String(dt.getUTCHours()).padStart(2, "0");
    const key = `${visit.profile}|${visit.commitState}|${date}|${hour}`;
    const bucket = buckets.get(key) ?? {
      profile: visit.profile,
      date,
      hour,
      count: 0,
      commitState: visit.commitState,
    };
    bucket.count += 1;
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
      visitsWithDurationCount: value(String(Math.max(0, bucket.count - 1))),
      visitsWithoutDurationCount: value("1"),
      totalDurationMicros: value(String(bucket.count * 240_000_000)),
    },
  }));
}

function buildHistoryMostVisited() {
  const rand = prng(202);
  const counts = new Map();
  for (const visit of HISTORY_VISITS) {
    if (visit.fields.url.state !== "value") continue;
    const url = visit.fields.url.value;
    counts.set(url, (counts.get(url) ?? 0) + 1 + Math.floor(rand() * 6));
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  return ranked.map(([url, count], index) => {
    let host = url;
    try {
      host = new URL(url).hostname;
    } catch {
      /* keep raw */
    }
    return {
      recordType: "finding",
      findingKind: "history_most_visited",
      profile: PROFILE_DEFAULT,
      commitState: "committed",
      provenance: provenance("urls", `most-visited-${index}`),
      fields: {
        url: value(url),
        title: value(titleFor(host)),
        supportingVisitCount: value(String(count)),
      },
    };
  });
}

/* -------------------------------- Cookies -------------------------------- */

const SAME_SITE = ["no_restriction", "lax", "strict", "unspecified"];

function buildCookies() {
  const rand = prng(303);
  const rows = [];
  for (let i = 0; i < 28; i += 1) {
    const profile = i % 4 === 0 ? PROFILE_SECOND : PROFILE_DEFAULT;
    const host = pick(rand, ALL_HOSTS);
    const daysAgo = Math.floor(rand() * 60);
    const created = isoAtSeeded(rand, daysAgo, Math.floor(rand() * 24), 0);
    const expires = isoAtSeeded(
      rand,
      daysAgo - 365,
      Math.floor(rand() * 24),
      0,
    );
    const lastAccess = isoAtSeeded(
      rand,
      Math.max(0, daysAgo - 3),
      Math.floor(rand() * 24),
      0,
    );
    const sidecar = i % 5 === 0;
    const commitState = sidecar
      ? i % 10 === 0
        ? "journal_resident"
        : "wal_resident"
      : "committed";
    const encrypted = i % 3 !== 0;
    const decryptable = encrypted && i % 9 !== 0;
    const names = [
      "session_id",
      "auth_token",
      "_ga",
      "csrf_token",
      "remember_me",
      "cf_clearance",
    ];
    rows.push({
      recordType: "finding",
      findingKind: "cookie",
      profile,
      commitState,
      provenance: provenance(
        "cookies",
        700_000 + i,
        sidecar ? SOURCE_USER_DATA : SOURCE_IMAGE,
      ),
      fields: {
        cookieId: value(String(700_000 + i)),
        // Chrome records a domain cookie's host key with a leading dot and
        // a host-only cookie's (most real cookies) without one.
        hostKey: value(i % 2 === 0 ? host : `.${host}`),
        name: value(pick(rand, names)),
        path: value("/"),
        topFrameSiteKey:
          i % 6 === 0
            ? unavailable("column not present in this Chrome version")
            : absent(),
        value: decryptable
          ? value(`${Math.random().toString(36).slice(2, 18)}`, {
              synthetic: false,
            })
          : encrypted
            ? unavailable(SEALED_REASON)
            : value(""),
        isEncrypted: value(encrypted),
        encryptedValueScheme: encrypted ? value("v10") : absent(),
        isSecure: value(true),
        isHttpOnly: value(i % 2 === 0),
        isPersistent: value(true),
        hasExpires: value(true),
        priority: value(pick(rand, ["low", "medium", "high"])),
        sameSite: value(pick(rand, SAME_SITE)),
        sourceScheme: value("secure"),
        sourcePort: value("443"),
        sourceType: value("http"),
        creationTime: timestamp(created),
        expiresTime: timestamp(expires),
        lastAccessTime: timestamp(lastAccess),
        lastUpdateTime: sidecar
          ? unavailable("row deleted, recovered from WAL without this field")
          : timestamp(lastAccess),
      },
      _host: host,
      _sortName: pick(rand, names),
    });
  }
  return rows;
}

/* ------------------------------ Credentials ------------------------------ */

function buildCredentials() {
  const rand = prng(404);
  const rows = [];
  const sites = [
    {
      origin: "https://hr-portal.northfieldpartners.internal/login",
      realm: "https://hr-portal.northfieldpartners.internal/",
      user: "msandoval",
    },
    {
      origin: "https://intranet.northfieldpartners.internal/login",
      realm: "https://intranet.northfieldpartners.internal/",
      user: "msandoval",
    },
    {
      origin: "https://www.coinbase.com/signin",
      realm: "https://www.coinbase.com/",
      user: "m.sandoval83@gmail.com",
    },
    {
      origin: "https://www.kraken.com/sign-in",
      realm: "https://www.kraken.com/",
      user: "msandoval_fin",
    },
    {
      origin: "https://onlinebanking.chase.com/login",
      realm: "https://onlinebanking.chase.com/",
      user: "msandoval1985",
    },
    {
      origin: "https://www.dropbox.com/login",
      realm: "https://www.dropbox.com/",
      user: "m.sandoval83@gmail.com",
    },
    {
      origin: "https://account.protonvpn.com/login",
      realm: "https://account.protonvpn.com/",
      user: "msandoval_priv",
    },
    {
      origin: "https://mail.protonmail.com/login",
      realm: "https://mail.protonmail.com/",
      user: "m.sandoval.priv@protonmail.com",
    },
    {
      origin: "https://www.linkedin.com/login",
      realm: "https://www.linkedin.com/",
      user: "m.sandoval83@gmail.com",
    },
    {
      origin: "https://www.teamviewer.com/login",
      realm: "https://www.teamviewer.com/",
      user: "msandoval@northfieldpartners.com",
    },
  ];
  sites.forEach((site, i) => {
    const daysAgo = 20 + i * 8;
    const created = isoAtSeeded(rand, daysAgo, 9, 0);
    const lastUsed = isoAtSeeded(rand, Math.max(0, daysAgo - 25), 14, 0);
    const sidecar = i % 4 === 0;
    const commitState = sidecar ? "wal_resident" : "committed";
    rows.push({
      recordType: "finding",
      findingKind: "login_credential",
      profile: i % 3 === 0 ? PROFILE_SECOND : PROFILE_DEFAULT,
      commitState,
      provenance: provenance(
        "logins",
        800_000 + i,
        sidecar ? SOURCE_USER_DATA : SOURCE_IMAGE,
      ),
      fields: {
        credentialId: value(String(800_000 + i)),
        originUrl: value(site.origin),
        actionUrl: value(site.origin),
        signonRealm: value(site.realm),
        usernameElement: value("username"),
        usernameValue: value(site.user),
        passwordElement: value("password"),
        // Passwords stay encrypted and are never shown, per product rule —
        // the mock mirrors that: secret is always unavailable, never a value.
        secret: unavailable(SEALED_REASON),
        secretEncryptionScheme: value("v10"),
        secretByteLength: value(String(48 + i)),
        dateCreated: timestamp(created),
        dateLastUsed: timestamp(lastUsed),
        datePasswordModified:
          i % 5 === 0
            ? unavailable("column not present in this Chrome version")
            : timestamp(created),
        timesUsed: value(String(2 + i)),
        blacklistedByUser: value(false),
        scheme: value("0"),
        displayName: i % 2 === 0 ? absent() : value(site.user),
        iconUrl: absent(),
        federationUrl: absent(),
        skipZeroClick: value(false),
      },
      _origin: site.origin,
      _user: site.user,
    });
  });
  return rows;
}

/* -------------------------------- Top sites -------------------------------- */

function buildTopSites() {
  const rand = prng(505);
  const hosts = [
    "www.coinbase.com",
    "mail.google.com",
    "intranet.northfieldpartners.internal",
    "www.linkedin.com",
    "www.google.com",
    "onlinebanking.chase.com",
    "www.dropbox.com",
    "www.kraken.com",
    "sharepoint.northfieldpartners.internal",
    "www.indeed.com",
    "account.protonvpn.com",
    "www.teamviewer.com",
    "www.bloomberg.com",
  ];
  return hosts.map((host, i) => {
    const sidecar = i % 6 === 0;
    return {
      recordType: "finding",
      findingKind: "top_site",
      profile: i % 5 === 0 ? PROFILE_SECOND : PROFILE_DEFAULT,
      commitState: sidecar ? "wal_resident" : "committed",
      provenance: provenance(
        "top_sites",
        900 + i,
        sidecar ? SOURCE_USER_DATA : SOURCE_IMAGE,
      ),
      fields: {
        topSiteId: value(String(900 + i)),
        url: value(urlFor(rand, host)),
        title: value(titleFor(host)),
        urlRank: value(String(i + 1)),
        redirects:
          i % 8 === 0
            ? unavailable("column not present in this Chrome version")
            : value(""),
      },
    };
  });
}

/* -------------------------------- Downloads -------------------------------- */

const DOWNLOAD_STATES = ["complete", "interrupted", "cancelled"];

function buildDownloads() {
  const rand = prng(606);
  const items = [
    {
      name: "Q1_wire_transfer_log.xlsx",
      host: "onlinebanking.chase.com",
      mime: "application/vnd.ms-excel",
    },
    {
      name: "client_ledger_export.csv",
      host: "sharepoint.northfieldpartners.internal",
      mime: "text/csv",
    },
    {
      name: "resume_msandoval_2024.pdf",
      host: "www.linkedin.com",
      mime: "application/pdf",
    },
    {
      name: "coinbase_statement_march.pdf",
      host: "www.coinbase.com",
      mime: "application/pdf",
    },
    {
      name: "company_financials_backup.zip",
      host: "drive.google.com",
      mime: "application/zip",
    },
    {
      name: "anydesk.exe",
      host: "www.anydesk.com",
      mime: "application/x-msdownload",
    },
    {
      name: "vpn_config.ovpn",
      host: "www.nordvpn.com",
      mime: "application/octet-stream",
    },
    {
      name: "offer_letter_rivermark.pdf",
      host: "www.indeed.com",
      mime: "application/pdf",
    },
    {
      name: "customer_contacts_export.xlsx",
      host: "intranet.northfieldpartners.internal",
      mime: "application/vnd.ms-excel",
    },
    {
      name: "usb_transfer_notes.txt",
      host: "www.google.com",
      mime: "text/plain",
    },
    {
      name: "kraken_2fa_backup_codes.pdf",
      host: "www.kraken.com",
      mime: "application/pdf",
    },
    {
      name: "teamviewer_setup.exe",
      host: "www.teamviewer.com",
      mime: "application/x-msdownload",
    },
  ];
  return items.map((item, i) => {
    const daysAgo = 3 + i * 4;
    const start = isoAtSeeded(rand, daysAgo, 10 + (i % 8), 0);
    const end = isoAtSeeded(rand, daysAgo, 10 + (i % 8), 4);
    const sidecar = i % 5 === 0;
    const state = pick(rand, DOWNLOAD_STATES);
    const totalBytes = 50_000 + Math.floor(rand() * 40_000_000);
    return {
      recordType: "finding",
      findingKind: "download",
      profile: i % 4 === 0 ? PROFILE_SECOND : PROFILE_DEFAULT,
      commitState: sidecar ? "wal_resident" : "committed",
      provenance: provenance(
        "downloads",
        1000 + i,
        sidecar ? SOURCE_USER_DATA : SOURCE_IMAGE,
      ),
      fields: {
        downloadId: value(String(1000 + i)),
        guid: value(`b2a1${i}-${i}c3d-4e5f-${1000 + i}`),
        targetPath: value(`C:\\Users\\msandoval\\Downloads\\${item.name}`),
        currentPath:
          state === "complete"
            ? value(`C:\\Users\\msandoval\\Downloads\\${item.name}`)
            : absent(),
        startTime: timestamp(start),
        endTime: state === "interrupted" ? absent() : timestamp(end),
        lastAccessTime: timestamp(end),
        receivedBytes: value(
          String(
            state === "interrupted" ? Math.floor(totalBytes / 3) : totalBytes,
          ),
        ),
        totalBytes: value(String(totalBytes)),
        state: value(state),
        dangerType: value("not_dangerous"),
        interruptReason:
          state === "interrupted" ? value("network_failed") : absent(),
        opened: value(i % 3 === 0),
        transient: value(false),
        referrer: value(`https://${item.host}/`),
        siteUrl: value(`https://${item.host}/`),
        tabUrl: value(`https://${item.host}/`),
        httpMethod: value("GET"),
        mimeType: value(item.mime),
        originalMimeType: value(item.mime),
        etag:
          i % 4 === 0
            ? unavailable("column not present in this Chrome version")
            : absent(),
        lastModified: absent(),
        originalUrl: value(
          `https://${item.host}/files/${encodeURIComponent(item.name)}`,
        ),
        finalUrl: value(
          `https://${item.host}/files/${encodeURIComponent(item.name)}`,
        ),
        urlChain: value([
          `https://${item.host}/files/${encodeURIComponent(item.name)}`,
        ]),
        urlChainLength: value("1"),
      },
      _targetPath: `C:\\Users\\msandoval\\Downloads\\${item.name}`,
      _startTime: start,
    };
  });
}

/* -------------------------------- Bookmarks -------------------------------- */

function buildBookmarks() {
  const rand = prng(707);
  const items = [
    {
      name: "Chase Online Banking",
      url: "https://onlinebanking.chase.com/login",
      folder: "Bookmarks Bar / Finance",
    },
    {
      name: "Coinbase",
      url: "https://www.coinbase.com/dashboard",
      folder: "Bookmarks Bar / Finance",
    },
    {
      name: "Kraken Pro",
      url: "https://www.kraken.com/dashboard",
      folder: "Bookmarks Bar / Finance",
    },
    {
      name: "LinkedIn Jobs - Finance Director",
      url: "https://www.linkedin.com/jobs/view/394021",
      folder: "Bookmarks Bar / Job Search",
    },
    {
      name: "Indeed - Saved Searches",
      url: "https://www.indeed.com/jobs?q=finance+director",
      folder: "Bookmarks Bar / Job Search",
    },
    {
      name: "NordVPN Setup Guide",
      url: "https://www.nordvpn.com/setup/windows",
      folder: "Other Bookmarks",
    },
    {
      name: "Company Intranet",
      url: "https://intranet.northfieldpartners.internal/",
      folder: "Bookmarks Bar",
    },
    {
      name: "Wire Transfer Policy",
      url: "https://intranet.northfieldpartners.internal/policies/data-handling",
      folder: "Bookmarks Bar / Work",
    },
    {
      name: "Personal Gmail",
      url: "https://mail.google.com/mail/u/0/#inbox",
      folder: "Other Bookmarks",
    },
    {
      name: "ProtonVPN Account",
      url: "https://account.protonvpn.com/account",
      folder: "Other Bookmarks",
    },
    {
      name: "Glassdoor - Company Reviews",
      url: "https://www.glassdoor.com/",
      folder: "Bookmarks Bar / Job Search",
    },
    {
      name: "Dropbox - Exports",
      url: "https://www.dropbox.com/home/exports",
      folder: "Bookmarks Bar / Work",
    },
  ];
  return items.map((item, i) => {
    const daysAgo = 5 + i * 6;
    const added = isoAtSeeded(rand, daysAgo, 12, 0);
    const source = i % 7 === 0 ? "backup" : "primary";
    return {
      recordType: "finding",
      findingKind: "bookmark",
      profile: i % 3 === 0 ? PROFILE_SECOND : PROFILE_DEFAULT,
      commitState: "committed",
      provenance: provenance(
        source === "backup" ? "Bookmarks.bak" : "Bookmarks",
        1100 + i,
        SOURCE_USER_DATA,
      ),
      fields: {
        bookmarkId: value(String(1100 + i)),
        guid: value(`c3d${i}e-4f${i}5-6a7b-8c9d-${1100 + i}0e1f`),
        name: value(item.name),
        url: value(item.url),
        dateAdded: timestamp(added),
        dateLastUsed: i % 3 === 0 ? timestamp(added) : absent(),
        sourceFile: value(source === "backup" ? "Bookmarks.bak" : "Bookmarks"),
        rootFolder: value(
          item.folder.startsWith("Bookmarks Bar") ? "bookmark_bar" : "other",
        ),
        parentFolder: value(item.folder.split(" / ").pop()),
        folderPath: value(item.folder, { synthetic: true }),
      },
      _source: source,
    };
  });
}

/* -------------------------------- Autofill -------------------------------- */

function buildAutofill() {
  const rand = prng(808);
  const items = [
    { name: "EMAIL_ADDRESS", value: "m.sandoval83@gmail.com" },
    { name: "NAME_FULL", value: "Marcus Sandoval" },
    { name: "PHONE_HOME_WHOLE_NUMBER", value: "+1 415 555 0142" },
    { name: "ADDRESS_HOME_STREET_ADDRESS", value: "482 Alder Street" },
    { name: "ADDRESS_HOME_CITY", value: "San Mateo" },
    { name: "ADDRESS_HOME_ZIP", value: "94401" },
    { name: "ADDRESS_HOME_COUNTRY", value: "US" },
    { name: "search-query", value: "how to wire transfer internationally" },
    { name: "search-query", value: "resignation letter template finance" },
    { name: "search-query", value: "usb data transfer speed comparison" },
    {
      name: "wallet_address",
      value: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
    },
    { name: "EMAIL_ADDRESS", value: "m.sandoval.priv@protonmail.com" },
    { name: "NAME_FIRST", value: "Marcus" },
    { name: "COMPANY_NAME", value: "Rivermark Capital" },
    { name: "CREDIT_CARD_NAME_FULL", value: "MARCUS SANDOVAL" },
  ];
  return items.map((item, i) => {
    const daysAgo = 8 + i * 5;
    const created = isoAtSeeded(rand, daysAgo, 11, 0);
    const lastUsed = isoAtSeeded(rand, Math.max(0, daysAgo - 10), 15, 0);
    const sidecar = i % 5 === 0;
    return {
      recordType: "finding",
      findingKind: "autofill_entry",
      profile: i % 4 === 1 ? PROFILE_SECOND : PROFILE_DEFAULT,
      commitState: sidecar ? "journal_resident" : "committed",
      provenance: provenance(
        "autofill",
        1200 + i,
        sidecar ? SOURCE_USER_DATA : SOURCE_IMAGE,
      ),
      fields: {
        autofillId: value(String(1200 + i)),
        fieldName: value(item.name),
        fieldValue: value(item.value),
        fieldValueLower: value(item.value.toLowerCase()),
        timesUsed: value(String(1 + Math.floor(rand() * 12))),
        dateCreated: timestamp(created),
        dateLastUsed: timestamp(lastUsed),
      },
    };
  });
}

/* ---------------------------------- Cache ---------------------------------- */

function buildCache() {
  const rand = prng(909);
  const rows = [];
  for (let i = 0; i < 22; i += 1) {
    const host = pick(rand, ALL_HOSTS);
    const daysAgo = Math.floor(rand() * 40);
    const lastUsed = isoAtSeeded(rand, daysAgo, Math.floor(rand() * 24), 0);
    const hash = Array.from({ length: 16 }, () =>
      Math.floor(rand() * 16).toString(16),
    ).join("");
    const readable = i % 8 !== 0;
    const sidecar = i % 4 === 0;
    rows.push({
      recordType: "finding",
      findingKind: "cache_entry",
      profile: i % 5 === 0 ? PROFILE_SECOND : PROFILE_DEFAULT,
      commitState: sidecar ? "wal_resident" : "committed",
      provenance: provenance(
        "simple_cache",
        `entry-${hash}`,
        sidecar ? SOURCE_USER_DATA : SOURCE_IMAGE,
      ),
      fields: {
        backend: value("simple"),
        entryHash: value(hash),
        key: readable
          ? value(urlFor(rand, host))
          : unavailable("value present but not a recognized encoding"),
        keyLength: value(String(30 + Math.floor(rand() * 60))),
        // Core writes the cache's integrity flags as "true" / "false".
        keyHashValid: value("true"),
        entryHashMatchesFilename: value("true"),
        keySha256: value(
          Array.from({ length: 8 }, () =>
            Math.floor(rand() * 16).toString(16),
          ).join(""),
        ),
        version: value("8.0"),
        lastUsed: timestamp(lastUsed),
        entrySizeBytes: value(String(500 + Math.floor(rand() * 900_000))),
        stream0Size: value(String(120 + Math.floor(rand() * 400))),
        stream1Size: value(String(200 + Math.floor(rand() * 800_000))),
      },
    });
  }
  return rows;
}

/* -------------------------------- Favicons -------------------------------- */

/** Mock favicon hues: muted brand-like fills, picked per host. */
const FAVICON_FILLS = [
  "#1f6feb",
  "#0f766e",
  "#b45309",
  "#7c3aed",
  "#be123c",
  "#334155",
  "#15803d",
  "#c2410c",
];

/**
 * A stand-in favicon bitmap for a host: a small SVG (a rounded square in a
 * host-picked hue with its initial), with the SHA-256 and byte length a
 * real recovered payload carries, so a row's own bitmap is found by its
 * `payloadSha256` (`favicon-bitmaps`) exactly as on a real Case.
 */
function faviconPayload(host) {
  const name = host.replace(/^www\./, "");
  const hash = createHash("sha256").update(name).digest();
  const fill = FAVICON_FILLS[hash[0] % FAVICON_FILLS.length];
  const letter = name.charAt(0).toUpperCase();
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">` +
    `<title>${name}</title>` +
    `<rect width="32" height="32" rx="7" fill="${fill}"/>` +
    `<text x="16" y="22" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#fff">${letter}</text>` +
    `</svg>`;
  const bytes = Buffer.from(svg, "utf8");
  return {
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    dataUri: `data:image/svg+xml;base64,${bytes.toString("base64")}`,
  };
}

function buildFavicons() {
  const rand = prng(1010);
  const hosts = ALL_HOSTS.slice(0, 18);
  return hosts.map((host, i) => {
    const daysAgo = Math.floor(rand() * 30);
    const updated = isoAtSeeded(rand, daysAgo, 8, 0);
    const sidecar = i % 6 === 0;
    const missing = i % 9 === 0;
    const payload = faviconPayload(host);
    return {
      recordType: "finding",
      findingKind: "favicon",
      profile: i % 5 === 0 ? PROFILE_SECOND : PROFILE_DEFAULT,
      commitState: sidecar ? "wal_resident" : "committed",
      provenance: provenance(
        "favicon_bitmaps",
        1300 + i,
        sidecar ? SOURCE_USER_DATA : SOURCE_IMAGE,
      ),
      fields: {
        bitmapId: value(String(1300 + i)),
        iconId: value(String(1400 + i)),
        iconUrl: missing
          ? unavailable("related row missing from this database")
          : value(`https://${host}/favicon.ico`),
        iconType: value("favicon"),
        width: value(String(pick(rand, [16, 32, 48]))),
        height: value(String(pick(rand, [16, 32, 48]))),
        lastUpdated: timestamp(updated),
        lastRequested: value(""),
        payloadSha256: missing ? absent() : value(payload.sha256),
        payloadBytes: missing ? absent() : value(String(payload.bytes.length)),
        payloadPath: missing
          ? absent()
          : value(`favicon-payloads/${payload.sha256}`),
        pageUrls: value([urlFor(rand, host)]),
      },
      // The stored bitmap, for the mock's `site-favicons` and
      // `favicon-bitmaps` routes (stripped from the wire row like every `_`
      // helper field).
      _dataUri: missing ? null : payload.dataUri,
    };
  });
}

/* --------------------------------------------------------------------------
 * Assembled export
 * ------------------------------------------------------------------------ */

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
  candidates: buildCandidates(),
  topicCandidates: buildTopicCandidates(),
};
