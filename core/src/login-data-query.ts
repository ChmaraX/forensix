import {
  createConditions,
  normalizeLimit,
  parseOption,
  QUERY_DIRECTIONS,
  resolveCommitState,
  resolveProfiles,
  resolveSearch,
  runFindingQuery,
  type FindingQuerySpec,
  type QueryDirection,
  type SortDefinition,
} from "./finding-query.js";
import { decodeFinding, type Identified } from "./record-store.js";
import type { CommitState, Finding } from "./forensic-model.js";

export interface CredentialQuery {
  readonly caseDirectory: string;
  readonly profiles?: readonly string[];
  readonly search?: string;
  readonly commitState?: CommitState;
  readonly sort?: CredentialSort;
  readonly direction?: QueryDirection;
  readonly limit?: number;
  readonly after?: string;
}

export interface CredentialPage {
  readonly status: "ok";
  readonly command: "credentials";
  readonly items: readonly Identified<Finding>[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

export const CREDENTIAL_SORTS = [
  "created-time",
  "last-used-time",
  "origin",
  "username",
  "profile",
] as const;
export type CredentialSort = (typeof CREDENTIAL_SORTS)[number];
const CREDENTIAL_KIND = "login_credential";

const SORTS: Readonly<Record<CredentialSort, SortDefinition>> = {
  "created-time": { expression: "COALESCE(f.sort_created, '')", kind: "text" },
  "last-used-time": {
    expression: "COALESCE(f.sort_last_used, '')",
    kind: "text",
  },
  origin: { expression: "COALESCE(f.sort_origin, '')", kind: "text" },
  username: { expression: "COALESCE(f.sort_username, '')", kind: "text" },
  profile: { expression: "f.profile_path", kind: "text" },
};

const CREDENTIAL_SPEC: FindingQuerySpec<CredentialQuery, Finding> = {
  label: "Credential",
  store: "logins",
  analysisNotFound: "Case has no Login Data analysis. Run analyse first.",
  decode: decodeFinding,
  plan: (input) => {
    const direction =
      parseOption(input.direction, "--direction", QUERY_DIRECTIONS) ?? "desc";
    const sort =
      parseOption(input.sort, "--sort", CREDENTIAL_SORTS) ?? "created-time";
    const commitState = resolveCommitState(input.commitState);
    const limit = normalizeLimit(input.limit, "Credential");
    const profiles = resolveProfiles(input.profiles, "Credential");
    const search = resolveSearch(input.search);

    const where = createConditions();
    where.add("f.finding_kind = ?", CREDENTIAL_KIND);
    if (commitState !== null) {
      where.add("f.commit_state = ?", commitState);
    }
    where.addProfiles(profiles);
    where.addSearch(search);

    return {
      direction,
      limit,
      sortDefinition: SORTS[sort],
      conditions: where.conditions,
      parameters: where.parameters,
      fingerprint: (identity) => ({
        caseId: identity.caseId,
        activeArtifactResultIds: identity.artifactResultIds,
        profiles,
        search,
        commitState,
        sort,
        direction,
      }),
    };
  },
};

export function queryCredentials(input: CredentialQuery): CredentialPage {
  const { items, nextCursor, limit } = runFindingQuery(CREDENTIAL_SPEC, input);
  return { status: "ok", command: "credentials", items, nextCursor, limit };
}
