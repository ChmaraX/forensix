/**
 * Human labels for wire field names, one shared map: the row sheet shows
 * the label with the raw name as a caption ("Visit id" over `visitId`), so
 * the sheet reads without knowing Chrome's schema and still names the exact
 * field. A name not in the map is spelled out from its camelCase
 * ("someNewField" → "Some new field"), never hidden.
 *
 * Kind-specific entries (`"cookie:value"`) win over the shared one.
 * Labels are presentation only: they never change which field is shown.
 */

const LABELS: Readonly<Record<string, string>> = {
  // Shared.
  url: "URL",
  title: "Title",
  name: "Name",
  guid: "GUID",
  scheme: "Scheme",
  scope: "Scope",
  version: "Version",
  // History.
  visitId: "Visit id",
  urlId: "URL id",
  urlRecordId: "URL record id",
  urlVisitCount: "Visits to this URL (Chrome's count)",
  typedCount: "Times typed",
  lastVisitTime: "Last visit to this URL",
  hidden: "Hidden from history",
  visitTime: "Visit time",
  fromVisit: "Came from visit",
  externalReferrerUrl: "External referrer",
  transitionRaw: "Transition (raw value)",
  transitionCore: "Arrived via",
  transitionQualifiers: "Transition qualifiers",
  redirectFromVisitId: "Redirected from visit",
  redirectToVisitIds: "Redirected to visits",
  segmentId: "Segment id",
  visitDuration: "Time on page",
  visitSource: "Visit source",
  localDate: "Local date",
  localHour: "Local hour",
  declaredTimezone: "Declared timezone",
  supportingVisitCount: "Visits",
  visitsWithDurationCount: "Visits with a time on page",
  visitsWithoutDurationCount: "Visits without a time on page",
  totalDurationMicros: "Total time on page (microseconds)",
  // Cookies.
  cookieId: "Cookie id",
  hostKey: "Host",
  path: "Path",
  topFrameSiteKey: "Top-frame site",
  "cookie:name": "Cookie name",
  "cookie:value": "Value",
  isEncrypted: "Encrypted",
  encryptedValueScheme: "Encryption scheme",
  isSecure: "Secure",
  isHttpOnly: "HttpOnly",
  isPersistent: "Persistent",
  hasExpires: "Has an expiry",
  priority: "Priority",
  sameSite: "SameSite",
  sourceScheme: "Source scheme",
  sourcePort: "Source port",
  sourceType: "Source type",
  creationTime: "Created",
  expiresTime: "Expires",
  lastAccessTime: "Last accessed",
  lastUpdateTime: "Last updated",
  // Saved logins.
  credentialId: "Login id",
  originUrl: "Origin",
  actionUrl: "Form action",
  signonRealm: "Sign-on realm",
  usernameElement: "Username field",
  usernameValue: "Username",
  passwordElement: "Password field",
  secret: "Password",
  secretEncryptionScheme: "Password encryption",
  secretByteLength: "Password length (bytes)",
  dateCreated: "Created",
  dateLastUsed: "Last used",
  datePasswordModified: "Password changed",
  timesUsed: "Times used",
  blacklistedByUser: "Never save (blocked by user)",
  displayName: "Display name",
  iconUrl: "Icon URL",
  federationUrl: "Federation URL",
  skipZeroClick: "Skip automatic sign-in",
  // Top sites.
  topSiteId: "Top site id",
  urlRank: "Rank",
  redirects: "Redirects",
  // Downloads.
  downloadId: "Download id",
  targetPath: "Saved to",
  currentPath: "Current path",
  startTime: "Started",
  endTime: "Ended",
  receivedBytes: "Received (bytes)",
  totalBytes: "Expected size (bytes)",
  "download:state": "Outcome",
  dangerType: "Danger type",
  interruptReason: "Interrupt reason",
  opened: "Opened",
  transient: "Transient",
  referrer: "Referrer",
  siteUrl: "Site",
  tabUrl: "Tab page",
  httpMethod: "HTTP method",
  mimeType: "MIME type",
  originalMimeType: "Original MIME type",
  etag: "ETag",
  lastModified: "Last modified (server)",
  originalUrl: "Original URL",
  finalUrl: "Final URL",
  urlChain: "URL chain",
  urlChainLength: "URL chain length",
  // Bookmarks.
  bookmarkId: "Bookmark id",
  "bookmark:name": "Bookmark name",
  dateAdded: "Added",
  sourceFile: "Source file",
  rootFolder: "Root folder",
  parentFolder: "Folder",
  folderPath: "Folder path",
  // Form data.
  autofillId: "Entry id",
  fieldName: "Form field",
  fieldValue: "Value",
  fieldValueLower: "Value (lower case)",
  // Cache.
  backend: "Backend",
  entryHash: "Entry hash",
  key: "Key",
  keyLength: "Key length",
  keyHashValid: "Key hash valid",
  entryHashMatchesFilename: "Entry hash matches file name",
  keySha256: "Key SHA-256",
  lastUsed: "Last used",
  entrySizeBytes: "Entry size (bytes)",
  stream0Size: "Stream 0 size (bytes)",
  stream1Size: "Stream 1 size (bytes)",
  // Favicons.
  bitmapId: "Bitmap id",
  iconId: "Icon id",
  iconType: "Icon type",
  width: "Width",
  height: "Height",
  lastUpdated: "Last updated",
  lastRequested: "Last requested",
  payloadSha256: "Image SHA-256",
  payloadBytes: "Image size (bytes)",
  pageUrls: "Page URLs",
  // Browser profile.
  chromeVersion: "Chrome version",
  variationsCountry: "Variations country",
  lastUsedProfile: "Last used profile",
  profileCount: "Profiles on device",
  osCryptKeyPresent: "Encryption key present",
  osCryptAppBoundKeyPresent: "App-bound encryption key present",
  profileName: "Profile name",
  createdByVersion: "Created by Chrome version",
  exitType: "Exit type",
  accountCount: "Accounts",
  accountEmail: "Account e-mail",
  accountGaiaId: "Account Gaia id",
  accountFullName: "Account full name",
  accountGivenName: "Account given name",
  accountLocale: "Account locale",
  accountHostedDomain: "Account hosted domain",
  workAreaLeft: "Work area left",
  workAreaTop: "Work area top",
  workAreaRight: "Work area right",
  workAreaBottom: "Work area bottom",
  screenWorkArea: "Screen work area",
  avatarIcon: "Avatar icon",
  gaiaName: "Gaia name",
  gaiaGivenName: "Gaia given name",
  gaiaId: "Gaia id",
  gaiaPictureFileName: "Gaia picture file",
  infoCacheUserName: "Cached user name",
  isUsingDefaultAvatar: "Default avatar",
  isUsingDefaultName: "Default name",
};

/** Words that keep their capitals when a name is spelled out. */
const ACRONYMS: Readonly<Record<string, string>> = {
  url: "URL",
  urls: "URLs",
  id: "id",
  ids: "ids",
  http: "HTTP",
  mime: "MIME",
  sha256: "SHA-256",
  guid: "GUID",
  os: "OS",
};

/** "someNewFieldUrl" → "Some new field URL". */
export function spellFieldName(name: string): string {
  const words = name
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim()
    .split(/\s+/)
    .filter((word) => word !== "")
    .map((word) => ACRONYMS[word.toLowerCase()] ?? word.toLowerCase());
  if (words.length === 0) {
    return name;
  }
  const [first = "", ...rest] = words;
  const head =
    first === first.toUpperCase()
      ? first
      : first.charAt(0).toUpperCase() + first.slice(1);
  return [head, ...rest].join(" ");
}

/** The human label for a field of a Finding kind. */
export function fieldLabel(name: string, kind?: string): string {
  return (
    (kind === undefined ? undefined : LABELS[`${kind}:${name}`]) ??
    LABELS[name] ??
    spellFieldName(name)
  );
}
