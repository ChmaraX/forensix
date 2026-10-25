/**
 * The design mock Case's context data: browser and profile metadata,
 * Candidates, topic Candidates and the Completeness Statement. Design-only,
 * like case-data.mjs; the people and accounts come from scenario.mjs.
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
  unavailable,
  value,
} from "./case-kit.mjs";
import { PERSONA, siteOf } from "./scenario.mjs";

/* -------------------------------- Metadata -------------------------------- */

export function buildMetadata() {
  const screen = {
    workAreaLeft: value("0"),
    workAreaTop: value("0"),
    workAreaRight: value("1512"),
    workAreaBottom: value("944"),
    screenWorkArea: value("1512x944"),
  };
  return [
    {
      recordType: "finding",
      findingKind: "browser_metadata",
      profile: PROFILE_DEFAULT,
      commitState: "committed",
      provenance: provenance("Local State", "browser", SOURCE_USER_DATA),
      fields: {
        scope: value("browser"),
        chromeVersion: value("123.0.6312.122"),
        variationsCountry: value("gb"),
        lastUsedProfile: value(PROFILE_DEFAULT),
        profileCount: value("2"),
        osCryptKeyPresent: value(true),
        osCryptAppBoundKeyPresent: value(false),
      },
    },
    {
      recordType: "finding",
      findingKind: "profile_metadata",
      profile: PROFILE_DEFAULT,
      commitState: "committed",
      provenance: provenance("Preferences", PROFILE_DEFAULT, SOURCE_USER_DATA),
      fields: {
        scope: value("profile"),
        profileName: value(`${PERSONA.givenName} (${PERSONA.company})`),
        createdByVersion: value("114.0.5735.198"),
        exitType: value("Normal"),
        accountCount: value("1"),
        accountEmail: value(PERSONA.workEmail),
        accountGaiaId: value("114827301928374650"),
        accountFullName: value(PERSONA.fullName),
        accountGivenName: value(PERSONA.givenName),
        accountLocale: value("en-GB"),
        accountHostedDomain: value("halden.io"),
        ...screen,
        avatarIcon: value("chrome://theme/IDR_PROFILE_AVATAR_26"),
        gaiaName: value(PERSONA.fullName),
        gaiaGivenName: value(PERSONA.givenName),
        gaiaId: value("114827301928374650"),
        gaiaPictureFileName: absent(),
        infoCacheUserName: value(PERSONA.workEmail),
        isUsingDefaultAvatar: value(false),
        isUsingDefaultName: value(false),
      },
    },
    {
      recordType: "finding",
      findingKind: "profile_metadata",
      profile: PROFILE_SECOND,
      commitState: "committed",
      provenance: provenance("Preferences", PROFILE_SECOND, SOURCE_USER_DATA),
      fields: {
        scope: value("profile"),
        profileName: value("Personal"),
        createdByVersion: value("116.0.5845.187"),
        exitType: value("Normal"),
        accountCount: value("1"),
        accountEmail: value(PERSONA.personalEmail),
        accountGaiaId: value("103948572610293847"),
        accountFullName: value(PERSONA.fullName),
        accountGivenName: unavailable("value could not be decrypted offline"),
        accountLocale: value("en-GB"),
        accountHostedDomain: absent(),
        ...screen,
        avatarIcon: value("chrome://theme/IDR_PROFILE_AVATAR_9"),
        gaiaName: value(PERSONA.fullName),
        gaiaGivenName: value(PERSONA.givenName),
        gaiaId: value("103948572610293847"),
        gaiaPictureFileName: absent(),
        infoCacheUserName: value(PERSONA.personalEmail),
        isUsingDefaultAvatar: value(true),
        isUsingDefaultName: value(false),
      },
    },
  ];
}

/* ------------------------------- Candidates ------------------------------- */

export function buildCandidates(hostCounts) {
  const identity = [
    ["identity_email", PERSONA.workEmail, 31, PROFILE_DEFAULT],
    ["identity_name", PERSONA.fullName, 18, PROFILE_DEFAULT],
    ["identity_email", PERSONA.personalEmail, 12, PROFILE_SECOND],
    ["identity_email", PERSONA.privateEmail, 5, PROFILE_DEFAULT],
    ["identity_phone", PERSONA.phone, 3, PROFILE_DEFAULT],
    [
      "identity_postal_address",
      `${PERSONA.street}, ${PERSONA.city} ${PERSONA.zip}`,
      2,
      PROFILE_DEFAULT,
    ],
    ["identity_country", PERSONA.country, 24, PROFILE_DEFAULT],
  ];
  const behavior = [
    ["behavior_frequent_host", "app.slack.com", hostCounts["app.slack.com"]],
    ["behavior_frequent_host", "www.figma.com", hostCounts["www.figma.com"]],
    [
      "behavior_frequent_host",
      "mail.google.com",
      hostCounts["mail.google.com"],
    ],
    ["behavior_search_query", "lumenworks lead product designer salary", 1],
    ["behavior_search_query", "clear chrome history mac", 1],
  ];
  // Core ranks each kind's candidates within one profile, strongest
  // (most supporting rows) first, and writes the same four fields on every
  // one (core/src/identity-candidates.ts `candidateFields`).
  const rows = [
    ...identity.map(([kind, text, count, profile], i) => ({
      kind,
      text,
      count,
      profile,
      category: "identity",
      basis: kind === "identity_country" ? "autofill+preferences" : "autofill",
      provenance: provenance("autofill", 900 + i),
    })),
    ...behavior.map(([kind, text, count], i) => ({
      kind,
      text,
      count,
      profile: PROFILE_DEFAULT,
      category: "behavior",
      basis: "history",
      provenance: provenance("visits", 950 + i),
    })),
  ];
  return rows.map((row, index) => ({
    recordType: "candidate",
    candidateKind: row.kind,
    category: row.category,
    profile: row.profile,
    // Ties keep their listed order.
    rank:
      rows.filter(
        (other, otherIndex) =>
          other.kind === row.kind &&
          other.profile === row.profile &&
          (other.count > row.count ||
            (other.count === row.count && otherIndex < index)),
      ).length + 1,
    supportingCount: row.count,
    provenance: row.provenance,
    fields: {
      candidateValue: value(row.text),
      normalizedValue: value(row.text.toLowerCase()),
      supportingCount: value(String(row.count)),
      evidenceBasis: value(row.basis),
    },
  }));
}

/* ---------------------------- Topic candidates ---------------------------- */

export function buildTopicCandidates(hostCounts) {
  const topics = [
    ["product_design", "Product & UX design", "www.figma.com", 0],
    ["team_collaboration", "Team collaboration", "app.slack.com", 0],
    ["job_search", "Job search", "www.linkedin.com", 1],
    ["file_sharing", "File sharing & cloud storage", "wetransfer.com", 0],
    ["travel_planning", "Travel planning", "www.airbnb.com", 0],
  ];
  return topics.map(([label, name, host, page], i) => {
    const [path, title] = siteOf(host).pages[page];
    return {
      recordType: "candidate",
      candidateKind: "topic",
      rank: i + 1,
      count: Math.max(2, hostCounts[host] ?? 2),
      provenance: provenance("visits", 970 + i),
      fields: {
        topicLabel: value(label),
        topicName: value(name),
        specialCategory: absent(),
        score: value(Math.round((0.92 - i * 0.09) * 100) / 100, {
          synthetic: true,
        }),
        scoreAxis: value("cosine", { synthetic: true }),
        modelId: value("topic-embed-mini-v2", { synthetic: true }),
        modelRevision: value("2024-02-01", { synthetic: true }),
        url: value(`https://${host}${path}`),
        title: value(title),
      },
    };
  });
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
  "Candidates",
];

export function buildCompleteness() {
  const statements = ARTIFACT_TABLES.map((artifact) => {
    // Every database the fixture serves rows for was read. The personal
    // Profile never filled a form, so it has no Web Data database: one
    // genuine absence. Unreadable artifacts belong to the `?degraded=1`
    // statement (server.mjs), which also withholds their rows.
    const perProfile = PROFILES.map((profile) => {
      const absentHere = artifact === "Web Data" && profile === PROFILE_SECOND;
      return {
        sourceId: SOURCE_IMAGE,
        profile,
        artifact,
        // Candidates are derived, not read from a file: core names the
        // artifact itself as their path.
        databasePath:
          artifact === "Preferences"
            ? `${profile}/Preferences`
            : artifact === "Candidates"
              ? "Candidates"
              : `${profile}/${artifact}`,
        outcome: absentHere ? "absent" : "produced",
        reason: absentHere
          ? "Profile directory has no Web Data database"
          : null,
        runId: "run-2024-04-16T09-12-00Z",
      };
    });
    const count = (outcome) =>
      perProfile.filter((a) => a.outcome === outcome).length;
    return {
      artifact,
      attempted: perProfile.length,
      produced: count("produced"),
      absent: count("absent"),
      unavailable: count("unavailable"),
      artifacts: perProfile,
    };
  });
  return { status: "ok", command: "completeness", caseId: CASE_ID, statements };
}
