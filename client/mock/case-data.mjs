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

const CASE_ID = "CASE-2024-0417";

const PROFILE_DEFAULT = "Default";
const PROFILE_SECOND = "Profile 2";
const PROFILES = [PROFILE_DEFAULT, PROFILE_SECOND];

const SOURCE_IMAGE = "src-01-disk-image";
const SOURCE_USER_DATA = "src-02-user-data-dir";

/* --------------------------- FieldState helpers -------------------------- */

function value(v, opts) {
  return opts?.synthetic === true
    ? { state: "value", value: v, synthetic: true }
    : { state: "value", value: v };
}

function absent() {
  return { state: "absent" };
}

function unavailable(reason) {
  return { state: "unavailable", reason };
}

const UNAVAILABLE_REASONS = [
  "column not present in this Chrome version",
  "value could not be decrypted offline",
  "row deleted, recovered from WAL without this field",
  "value present but not a recognized encoding",
  "related row missing from this database",
];

function reasonFor(seed) {
  return UNAVAILABLE_REASONS[seed % UNAVAILABLE_REASONS.length];
}

/** Deterministic pseudo-random in [0, 1) so fixture generation is stable. */
function prng(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

function pick(rand, list) {
  return list[Math.floor(rand() * list.length) % list.length];
}

function timestamp(isoUtc) {
  return value({
    utc: isoUtc,
    raw: String((new Date(isoUtc).getTime() + 11_644_473_600_000) * 1000),
  });
}

function isoAt(daysAgo, hour, minute) {
  const base = new Date("2024-04-17T12:00:00.000Z");
  base.setUTCDate(base.getUTCDate() - daysAgo);
  base.setUTCHours(hour, minute, Math.floor(Math.random() * 60), 0);
  return base.toISOString();
}

/** Deterministic ISO timestamp derived from a seed, not Math.random. */
function isoAtSeeded(rand, daysAgo, hour, minute) {
  const base = new Date("2024-04-17T12:00:00.000Z");
  base.setUTCDate(base.getUTCDate() - daysAgo);
  const jitterMinute = Math.floor(rand() * 60);
  base.setUTCHours(hour, minute + jitterMinute, Math.floor(rand() * 60), 0);
  return base.toISOString();
}

function provenance(table, rowId, sourceId = SOURCE_USER_DATA, extra) {
  return {
    manifestPath: `${sourceId}/manifest.jsonl`,
    table,
    rowId: String(rowId),
    ...extra,
  };
}

/* -------------------------------- Domains -------------------------------- */

const EMAIL_DOMAINS = ["gmail.com", "outlook.com", "protonmail.com"];
const BANKING_HOSTS = [
  "onlinebanking.chase.com",
  "secure.bankofamerica.com",
  "www.wellsfargo.com",
];
const CRYPTO_HOSTS = ["www.coinbase.com", "www.binance.com", "www.kraken.com"];
const CLOUD_HOSTS = [
  "drive.google.com",
  "www.dropbox.com",
  "onedrive.live.com",
];
const JOB_HOSTS = ["www.linkedin.com", "www.indeed.com", "www.glassdoor.com"];
const VPN_HOSTS = [
  "www.nordvpn.com",
  "www.expressvpn.com",
  "account.protonvpn.com",
];
const INTERNAL_HOSTS = [
  "intranet.northfieldpartners.internal",
  "vpn-gateway.northfieldpartners.internal",
  "sharepoint.northfieldpartners.internal",
  "hr-portal.northfieldpartners.internal",
];
const SOCIAL_HOSTS = ["twitter.com", "www.reddit.com", "www.facebook.com"];
const NEWS_HOSTS = ["www.bloomberg.com", "www.reuters.com", "www.wsj.com"];
const SEARCH_HOSTS = ["www.google.com", "www.bing.com", "duckduckgo.com"];
const REMOTE_ACCESS_HOSTS = [
  "www.teamviewer.com",
  "www.anydesk.com",
  "remotedesktop.google.com",
];
const WEBMAIL_HOSTS = [
  "mail.google.com",
  "outlook.office.com",
  "mail.protonmail.com",
];

const ALL_HOSTS = [
  ...EMAIL_DOMAINS,
  ...BANKING_HOSTS,
  ...CRYPTO_HOSTS,
  ...CLOUD_HOSTS,
  ...JOB_HOSTS,
  ...VPN_HOSTS,
  ...INTERNAL_HOSTS,
  ...SOCIAL_HOSTS,
  ...NEWS_HOSTS,
  ...SEARCH_HOSTS,
  ...REMOTE_ACCESS_HOSTS,
  ...WEBMAIL_HOSTS,
];

const PATHS_BY_CATEGORY = {
  banking: [
    "/login",
    "/accounts/transfer",
    "/statements/2024-03",
    "/wires/new",
  ],
  crypto: ["/dashboard", "/trade/BTC-USD", "/withdraw", "/portfolio"],
  cloud: ["/drive/folders/exports", "/s/company-financials", "/download"],
  job: ["/jobs/view/394021", "/in/msandoval-finance", "/company/rivermark"],
  vpn: ["/download", "/account/servers", "/setup/windows"],
  internal: [
    "/",
    "/policies/data-handling",
    "/finance/wire-approvals",
    "/hr/offboarding",
  ],
  social: ["/", "/messages", "/search?q=resume%20tips"],
  news: ["/markets", "/technology", "/business/deals"],
  search: [
    "/search?q=how+to+wire+transfer+internationally",
    "/search?q=resign+notice+period",
    "/search?q=usb+data+transfer+speed",
  ],
  remote: ["/download", "/session/new", "/support"],
  webmail: ["/mail/u/0/#inbox", "/mail/u/0/#sent", "/owa/"],
};

function categoryOf(host) {
  if (EMAIL_DOMAINS.includes(host)) return "webmail";
  if (BANKING_HOSTS.includes(host)) return "banking";
  if (CRYPTO_HOSTS.includes(host)) return "crypto";
  if (CLOUD_HOSTS.includes(host)) return "cloud";
  if (JOB_HOSTS.includes(host)) return "job";
  if (VPN_HOSTS.includes(host)) return "vpn";
  if (INTERNAL_HOSTS.includes(host)) return "internal";
  if (SOCIAL_HOSTS.includes(host)) return "social";
  if (NEWS_HOSTS.includes(host)) return "news";
  if (SEARCH_HOSTS.includes(host)) return "search";
  if (REMOTE_ACCESS_HOSTS.includes(host)) return "remote";
  if (WEBMAIL_HOSTS.includes(host)) return "webmail";
  return "internal";
}

function urlFor(rand, host) {
  const category = categoryOf(host);
  const paths = PATHS_BY_CATEGORY[category] ?? ["/"];
  return `https://${host}${pick(rand, paths)}`;
}

const TITLES_BY_CATEGORY = {
  banking: "Online Banking - Accounts",
  crypto: "Trade - Portfolio",
  cloud: "My Drive",
  job: "LinkedIn - Jobs",
  vpn: "VPN - Account",
  internal: "Northfield Partners Intranet",
  social: "Home",
  news: "Markets",
  search: "Search results",
  remote: "Remote Desktop",
  webmail: "Inbox",
};

function titleFor(host) {
  return TITLES_BY_CATEGORY[categoryOf(host)] ?? host;
}

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
      declaredTimezone: value("UTC"),
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
        hostKey: value(`.${host}`),
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
            ? unavailable("value could not be decrypted offline")
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
    const decryptable = i % 3 !== 0;
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
        secret: decryptable
          ? unavailable("value could not be decrypted offline")
          : unavailable("value could not be decrypted offline"),
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
        keyHashValid: value(true),
        entryHashMatchesFilename: value(true),
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

function buildFavicons() {
  const rand = prng(1010);
  const hosts = ALL_HOSTS.slice(0, 18);
  return hosts.map((host, i) => {
    const daysAgo = Math.floor(rand() * 30);
    const updated = isoAtSeeded(rand, daysAgo, 8, 0);
    const sidecar = i % 6 === 0;
    const missing = i % 9 === 0;
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
        payloadSha256: missing
          ? absent()
          : value(
              Array.from({ length: 12 }, () =>
                Math.floor(rand() * 16).toString(16),
              ).join(""),
            ),
        payloadBytes: missing
          ? absent()
          : value(String(200 + Math.floor(rand() * 4000))),
        pageUrls: value([urlFor(rand, host)]),
      },
    };
  });
}

/* -------------------------------- Metadata -------------------------------- */

function buildMetadata() {
  const rows = [];
  rows.push({
    recordType: "finding",
    findingKind: "browser_metadata",
    profile: PROFILE_DEFAULT,
    commitState: "committed",
    provenance: provenance("Local State", "browser", SOURCE_USER_DATA),
    fields: {
      scope: value("browser"),
      chromeVersion: value("123.0.6312.122"),
      variationsCountry: value("us"),
      lastUsedProfile: value("Default"),
      profileCount: value("2"),
      osCryptKeyPresent: value(true),
      osCryptAppBoundKeyPresent: value(false),
    },
  });
  rows.push({
    recordType: "finding",
    findingKind: "profile_metadata",
    profile: PROFILE_DEFAULT,
    commitState: "committed",
    provenance: provenance("Preferences", PROFILE_DEFAULT, SOURCE_USER_DATA),
    fields: {
      scope: value("profile"),
      profileName: value("Marcus Sandoval"),
      createdByVersion: value("118.0.5993.90"),
      exitType: value("Normal"),
      accountCount: value("1"),
      accountEmail: value("m.sandoval83@gmail.com"),
      accountGaiaId: value("108234871029384756"),
      accountFullName: value("Marcus Sandoval"),
      accountGivenName: value("Marcus"),
      accountLocale: value("en-US"),
      accountHostedDomain: unavailable(
        "column not present in this Chrome version",
      ),
      workAreaLeft: value("0"),
      workAreaTop: value("0"),
      workAreaRight: value("1920"),
      workAreaBottom: value("1040"),
      screenWorkArea: value("1920x1040"),
      avatarIcon: value("chrome://theme/IDR_PROFILE_AVATAR_26"),
      gaiaName: value("Marcus Sandoval"),
      gaiaGivenName: value("Marcus"),
      gaiaId: value("108234871029384756"),
      gaiaPictureFileName: absent(),
      infoCacheUserName: value("m.sandoval83@gmail.com"),
      isUsingDefaultAvatar: value(false),
      isUsingDefaultName: value(false),
    },
  });
  rows.push({
    recordType: "finding",
    findingKind: "profile_metadata",
    profile: PROFILE_SECOND,
    commitState: "committed",
    provenance: provenance("Preferences", PROFILE_SECOND, SOURCE_USER_DATA),
    fields: {
      scope: value("profile"),
      profileName: value("Personal"),
      createdByVersion: value("120.0.6099.199"),
      exitType: value("Crashed"),
      accountCount: value("1"),
      accountEmail: value("m.sandoval.priv@protonmail.com"),
      accountGaiaId: absent(),
      accountFullName: unavailable("value could not be decrypted offline"),
      accountGivenName: absent(),
      accountLocale: value("en-US"),
      accountHostedDomain: absent(),
      workAreaLeft: value("0"),
      workAreaTop: value("0"),
      workAreaRight: value("1920"),
      workAreaBottom: value("1040"),
      screenWorkArea: value("1920x1040"),
      avatarIcon: value("chrome://theme/IDR_PROFILE_AVATAR_9"),
      gaiaName: absent(),
      gaiaGivenName: absent(),
      gaiaId: absent(),
      gaiaPictureFileName: absent(),
      infoCacheUserName: value("m.sandoval.priv@protonmail.com"),
      isUsingDefaultAvatar: value(true),
      isUsingDefaultName: value(true),
    },
  });
  return rows;
}

/* ------------------------------- Candidates ------------------------------- */

function buildCandidates() {
  const identity = [
    {
      kind: "identity_email",
      value: "m.sandoval83@gmail.com",
      supportingCount: 14,
      profile: PROFILE_DEFAULT,
    },
    {
      kind: "identity_email",
      value: "m.sandoval.priv@protonmail.com",
      supportingCount: 6,
      profile: PROFILE_SECOND,
    },
    {
      kind: "identity_name",
      value: "Marcus Sandoval",
      supportingCount: 9,
      profile: PROFILE_DEFAULT,
    },
    {
      kind: "identity_phone",
      value: "+1 415 555 0142",
      supportingCount: 3,
      profile: PROFILE_DEFAULT,
    },
    {
      kind: "identity_postal_address",
      value: "482 Alder Street, San Mateo, CA 94401",
      supportingCount: 2,
      profile: PROFILE_DEFAULT,
    },
    {
      kind: "identity_country",
      value: "US",
      supportingCount: 21,
      profile: PROFILE_DEFAULT,
    },
  ];
  const behavior = [
    {
      kind: "behavior_frequent_host",
      value: "intranet.northfieldpartners.internal",
      supportingCount: 41,
      profile: PROFILE_DEFAULT,
    },
    {
      kind: "behavior_frequent_host",
      value: "www.coinbase.com",
      supportingCount: 27,
      profile: PROFILE_DEFAULT,
    },
    {
      kind: "behavior_search_query",
      value: "how to wire transfer internationally",
      supportingCount: 4,
      profile: PROFILE_DEFAULT,
    },
    {
      kind: "behavior_search_query",
      value: "resignation letter template finance",
      supportingCount: 2,
      profile: PROFILE_DEFAULT,
    },
    {
      kind: "behavior_frequent_host",
      value: "account.protonvpn.com",
      supportingCount: 11,
      profile: PROFILE_SECOND,
    },
  ];
  const rows = [];
  identity.forEach((c, i) => {
    rows.push({
      recordType: "candidate",
      candidateKind: c.kind,
      category: "identity",
      profile: c.profile,
      rank: i + 1,
      supportingCount: c.supportingCount,
      provenance: provenance("autofill", 2000 + i),
      // Matches core's real field key (core/src/identity-candidates.ts
      // `candidateFields`) — the design mock previously used a different
      // key ("value") than the real analyzer output, which the client
      // silently rendered as "absent" instead of the guess.
      fields: { candidateValue: value(c.value) },
    });
  });
  behavior.forEach((c, i) => {
    rows.push({
      recordType: "candidate",
      candidateKind: c.kind,
      category: "behavior",
      profile: c.profile,
      rank: i + 1,
      supportingCount: c.supportingCount,
      provenance: provenance("visits", 2100 + i),
      fields: { candidateValue: value(c.value) },
    });
  });
  return rows;
}

/* ---------------------------- Topic candidates ---------------------------- */

function buildTopicCandidates() {
  const topics = [
    {
      label: "cryptocurrency_trading",
      name: "Cryptocurrency trading",
      count: 38,
      url: "https://www.coinbase.com/dashboard",
    },
    {
      label: "active_job_search",
      name: "Active job search",
      count: 22,
      url: "https://www.linkedin.com/jobs/view/394021",
    },
    {
      label: "international_travel_planning",
      name: "International travel planning",
      count: 9,
      url: "https://www.google.com/search?q=flights+to+lisbon",
    },
    {
      label: "personal_finance_management",
      name: "Personal finance management",
      count: 17,
      url: "https://onlinebanking.chase.com/accounts/transfer",
    },
    {
      label: "remote_access_tooling",
      name: "Remote access tooling",
      count: 6,
      url: "https://www.anydesk.com/download",
    },
  ];
  return topics.map((topic, i) => ({
    recordType: "candidate",
    candidateKind: "topic",
    rank: i + 1,
    count: topic.count,
    provenance: provenance("visits", 2200 + i),
    fields: {
      topicLabel: value(topic.label),
      topicName: value(topic.name),
      specialCategory: absent(),
      score: value(Math.round((0.94 - i * 0.11) * 100) / 100, {
        synthetic: true,
      }),
      scoreAxis: value("cosine", { synthetic: true }),
      modelId: value("topic-embed-mini-v2", { synthetic: true }),
      modelRevision: value("2024-02-01", { synthetic: true }),
      url: value(topic.url),
      title: value(titleFor(new URL(topic.url).hostname)),
    },
  }));
}

/* ------------------------------ Completeness ------------------------------ */

const ARTIFACT_TABLES = [
  "History",
  "Cookies",
  "Login Data",
  "Top Sites",
  "Downloads",
  "Bookmarks",
  "Web Data",
  "Cache",
  "Favicons",
  "Preferences",
];

function buildCompleteness() {
  const statements = ARTIFACT_TABLES.map((artifact) => {
    // Every database the fixture serves rows for was read: an unreadable
    // artifact belongs to the `?degraded=1` statement (server.mjs), which
    // also withholds its rows.
    const perProfile = PROFILES.map((profile, i) => {
      const outcome = "produced";
      return {
        sourceId: i === 0 ? SOURCE_IMAGE : SOURCE_USER_DATA,
        profile,
        artifact,
        databasePath:
          artifact === "Preferences"
            ? `${profile}/Preferences`
            : `${profile}/${artifact.replace(/ /g, " ")}`,
        outcome,
        reason: null,
        runId: "run-2024-04-17T09-12-00Z",
      };
    });
    // Give one artifact a genuine "absent" entry (a Profile that simply
    // never wrote this database) so all three non-produced outcomes exist.
    if (artifact === "Web Data") {
      perProfile.push({
        sourceId: SOURCE_IMAGE,
        profile: "Profile 3 (Guest)",
        artifact,
        databasePath: "Profile 3 (Guest)/Web Data",
        outcome: "absent",
        reason: "Profile directory has no Web Data database",
        runId: "run-2024-04-17T09-12-00Z",
      });
    }
    const attempted = perProfile.length;
    const produced = perProfile.filter((a) => a.outcome === "produced").length;
    const absentCount = perProfile.filter((a) => a.outcome === "absent").length;
    const unavailableCount = perProfile.filter(
      (a) => a.outcome === "unavailable",
    ).length;
    return {
      artifact,
      attempted,
      produced,
      absent: absentCount,
      unavailable: unavailableCount,
      artifacts: perProfile,
    };
  });
  return { status: "ok", command: "completeness", caseId: CASE_ID, statements };
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
