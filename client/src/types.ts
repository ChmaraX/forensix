/**
 * Wire types for the read-only dashboard API.
 *
 * These mirror what the loopback server returns from the analyzer core. The
 * client contains no forensic logic: every value arrives already typed as a
 * FieldState and is only presented.
 */

export type CommitState = "committed" | "wal_resident" | "journal_resident";

export type FieldState =
  | {
      readonly state: "value";
      readonly value: unknown;
      readonly synthetic?: boolean;
    }
  | { readonly state: "absent" }
  | { readonly state: "unavailable"; readonly reason: string };

export interface Provenance {
  readonly manifestPath?: string;
  readonly table?: string;
  readonly rowId?: string;
}

export interface Finding {
  readonly recordType: "finding";
  readonly findingKind: string;
  readonly profile: string;
  readonly commitState: CommitState;
  readonly provenance: Provenance;
  readonly fields: Readonly<Record<string, FieldState>>;
}

export interface PageOf<Row> {
  readonly status: "ok";
  readonly items: readonly Row[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

export type SiteArtifactKind =
  | "visits"
  | "cookies"
  | "saved_logins"
  | "bookmarks"
  | "top_sites"
  | "form_data";

export interface SiteHost {
  readonly host: string;
  readonly counts: Readonly<Record<SiteArtifactKind, number>>;
}

export interface SiteFinding extends Finding {
  readonly artifactKind: SiteArtifactKind;
}

export interface CompletenessArtifact {
  readonly sourceId: string;
  readonly profile: string;
  readonly artifact: string;
  readonly databasePath: string;
  readonly outcome: "produced" | "absent" | "unavailable";
  readonly reason: string | null;
  readonly runId: string;
}

export interface CompletenessStatement {
  readonly artifact: string;
  readonly attempted: number;
  readonly produced: number;
  readonly absent: number;
  readonly unavailable: number;
  readonly artifacts: readonly CompletenessArtifact[];
}

export interface CaseCompleteness {
  readonly statements: readonly CompletenessStatement[];
}

export interface CaseProfiles {
  readonly profiles: readonly string[];
}

export interface ExtraFilter {
  readonly parameter: string;
  readonly label: string;
  /** When present the filter renders a select of these values, not a text box. */
  readonly options?: readonly string[];
  /** Placeholder for free-text extras (for example an ISO instant). */
  readonly placeholder?: string;
}

export interface ArtifactConfig {
  readonly key: string;
  readonly label: string;
  /** One line under the page title describing what this artifact holds. */
  readonly description: string;
  readonly route: string;
  readonly completenessArtifact: string;
  readonly sorts: readonly string[];
  readonly extras: readonly ExtraFilter[];
  /** Direction options; the first is the default. Defaults to desc-then-asc. */
  readonly directions?: readonly string[];
  /** Cache records arrive with their Commit State already mixed; the query cannot filter it. */
  readonly combinedFindingList?: boolean;
}
