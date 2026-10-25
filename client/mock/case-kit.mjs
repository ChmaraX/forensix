/**
 * The design mock Case's shared fixture kit: the Case's identity and
 * profiles, the FieldState builders (core's shapes: `value`, `absent`,
 * `unavailable`, `timestamp` as a `ForensicTimestamp`), the seeded random
 * helpers and the scenario's hosts, URLs and titles. Design-only, like
 * case-data.mjs.
 */

export const CASE_ID = "CASE-2024-0417";

export const PROFILE_DEFAULT = "Default";
export const PROFILE_SECOND = "Profile 2";
export const PROFILES = [PROFILE_DEFAULT, PROFILE_SECOND];

export const SOURCE_IMAGE = "src-01-disk-image";
export const SOURCE_USER_DATA = "src-02-user-data-dir";

/* --------------------------- FieldState helpers -------------------------- */

export function value(v, opts) {
  return opts?.synthetic === true
    ? { state: "value", value: v, synthetic: true }
    : { state: "value", value: v };
}

export function absent() {
  return { state: "absent" };
}

export function unavailable(reason) {
  return { state: "unavailable", reason };
}

export const UNAVAILABLE_REASONS = [
  "column not present in this Chrome version",
  "value could not be decrypted offline",
  "row deleted, recovered from WAL without this field",
  "value present but not a recognized encoding",
  "related row missing from this database",
];

/** The reason core gives an encrypted value analysed without the OS key
 *  material (the dashboard words it "sealed"). */
export const SEALED_REASON = "encrypted_secret_without_key_material";

export function reasonFor(seed) {
  return UNAVAILABLE_REASONS[seed % UNAVAILABLE_REASONS.length];
}

/** Deterministic pseudo-random in [0, 1) so fixture generation is stable. */
export function prng(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

export function pick(rand, list) {
  return list[Math.floor(rand() * list.length) % list.length];
}

/** The mock Case's declared timezone (`analyse --timezone`): every
 *  timestamp and activity row declares it, as core writes them. */
export const DECLARED_TIMEZONE = "UTC";

/** A Chrome (1601-epoch microseconds) timestamp as core's
 *  `ForensicTimestamp`: the raw value, its epoch family, the UTC instant,
 *  the declared timezone and the resolution. */
export function timestamp(isoUtc) {
  return value({
    raw: String((new Date(isoUtc).getTime() + 11_644_473_600_000) * 1000),
    epochFamily: "1601-us",
    utc: isoUtc,
    declaredTimezone: DECLARED_TIMEZONE,
    resolution: "verified_schema_version_42",
  });
}

export function isoAt(daysAgo, hour, minute) {
  const base = new Date("2024-04-17T12:00:00.000Z");
  base.setUTCDate(base.getUTCDate() - daysAgo);
  base.setUTCHours(hour, minute, Math.floor(Math.random() * 60), 0);
  return base.toISOString();
}

/** Deterministic ISO timestamp derived from a seed, not Math.random. */
export function isoAtSeeded(rand, daysAgo, hour, minute) {
  const base = new Date("2024-04-17T12:00:00.000Z");
  base.setUTCDate(base.getUTCDate() - daysAgo);
  const jitterMinute = Math.floor(rand() * 60);
  base.setUTCHours(hour, minute + jitterMinute, Math.floor(rand() * 60), 0);
  return base.toISOString();
}

export function provenance(table, rowId, sourceId = SOURCE_USER_DATA, extra) {
  return {
    manifestPath: `${sourceId}/manifest.jsonl`,
    table,
    rowId: String(rowId),
    ...extra,
  };
}

/* -------------------------------- Domains -------------------------------- */

export const EMAIL_DOMAINS = ["gmail.com", "outlook.com", "protonmail.com"];
export const BANKING_HOSTS = [
  "onlinebanking.chase.com",
  "secure.bankofamerica.com",
  "www.wellsfargo.com",
];
export const CRYPTO_HOSTS = [
  "www.coinbase.com",
  "www.binance.com",
  "www.kraken.com",
];
export const CLOUD_HOSTS = [
  "drive.google.com",
  "www.dropbox.com",
  "onedrive.live.com",
];
export const JOB_HOSTS = [
  "www.linkedin.com",
  "www.indeed.com",
  "www.glassdoor.com",
];
export const VPN_HOSTS = [
  "www.nordvpn.com",
  "www.expressvpn.com",
  "account.protonvpn.com",
];
export const INTERNAL_HOSTS = [
  "intranet.northfieldpartners.internal",
  "vpn-gateway.northfieldpartners.internal",
  "sharepoint.northfieldpartners.internal",
  "hr-portal.northfieldpartners.internal",
];
export const SOCIAL_HOSTS = [
  "twitter.com",
  "www.reddit.com",
  "www.facebook.com",
];
export const NEWS_HOSTS = [
  "www.bloomberg.com",
  "www.reuters.com",
  "www.wsj.com",
];
export const SEARCH_HOSTS = [
  "www.google.com",
  "www.bing.com",
  "duckduckgo.com",
];
export const REMOTE_ACCESS_HOSTS = [
  "www.teamviewer.com",
  "www.anydesk.com",
  "remotedesktop.google.com",
];
export const WEBMAIL_HOSTS = [
  "mail.google.com",
  "outlook.office.com",
  "mail.protonmail.com",
];

export const ALL_HOSTS = [
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

export const PATHS_BY_CATEGORY = {
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

export function categoryOf(host) {
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

export function urlFor(rand, host) {
  const category = categoryOf(host);
  const paths = PATHS_BY_CATEGORY[category] ?? ["/"];
  return `https://${host}${pick(rand, paths)}`;
}

export const TITLES_BY_CATEGORY = {
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

export function titleFor(host) {
  return TITLES_BY_CATEGORY[categoryOf(host)] ?? host;
}
