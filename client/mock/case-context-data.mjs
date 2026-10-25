/**
 * The design mock Case's context data: browser and profile metadata,
 * Candidates, topic Candidates and the Completeness Statement. Design-only,
 * like case-data.mjs.
 */

import {
  CASE_ID,
  PROFILES,
  PROFILE_DEFAULT,
  PROFILE_SECOND,
  SOURCE_IMAGE,
  SOURCE_USER_DATA,
  absent,
  provenance,
  titleFor,
  unavailable,
  value,
} from "./case-kit.mjs";

/* -------------------------------- Metadata -------------------------------- */

export function buildMetadata() {
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

export function buildCandidates() {
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

export function buildTopicCandidates() {
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

export function buildCompleteness() {
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
