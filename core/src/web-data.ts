import type {
  PersistedAutofillFinding,
  WebDataArtifactWrite,
} from "./case-findings.js";
import type { CaseSourceRecord } from "./case.js";
import { ForensixError } from "./errors.js";
import {
  createFinding,
  valueField,
  type FieldState,
  type Finding,
} from "./forensic-model.js";
import type { ForensicTimestamp } from "./history.js";
import {
  citedPasses,
  completeArtifactHeader,
  preservedInteger,
  preservedString,
  readFailureHeader,
  resolveProfileDatabase,
  sourceRowProvenance,
  timestampField,
  type CitedPass,
  type RawSqliteValue,
  type SqliteArtifactHeader,
} from "./sqlite-artifact.js";
import { readWebDataPasses, type WebDataPass } from "./web-data-sqlite.js";

function textValue(field: FieldState<string>): string {
  return field.state === "value" ? field.value : "";
}

function timeValue(field: FieldState<ForensicTimestamp>): string | null {
  return field.state === "value" ? field.value.utc : null;
}

function buildAutofillEntries(
  cited: CitedPass<WebDataPass>,
  profile: string,
  declaredTimezone: string,
): PersistedAutofillFinding[] {
  const { schema } = cited.pass;
  // Chrome stores `autofill` times with `base::Time::ToTimeT()`: whole seconds
  // since 1970-01-01 UTC on every platform, so no Declared Origin OS is needed.
  const epoch = {
    epochFamily: "unix-seconds",
    resolution: `verified_web_data_schema_version_${schema.version}`,
  } as const;
  return cited.pass.rows.map((row) => {
    if (row.rowId === null) {
      throw new ForensixError(
        "ANALYSIS_FAILED",
        "Web Data autofill.rowid is not an exact integer.",
      );
    }
    const rowId = row.rowId.toString();
    const get = (column: string): RawSqliteValue =>
      row.values.get(column) ?? null;
    const time = (column: string): FieldState<ForensicTimestamp> =>
      timestampField(
        get(column),
        schema.columns.has(column),
        epoch,
        declaredTimezone,
      );
    const fieldName = preservedString(get("name"));
    const fieldValue = preservedString(get("value"));
    const dateCreated = time("date_created");
    const dateLastUsed = time("date_last_used");
    const finding: Finding = createFinding({
      findingKind: "autofill_entry",
      profile,
      commitState: cited.commitState,
      provenance: {
        ...sourceRowProvenance(cited.manifest, "autofill", rowId),
        ...(cited.recoveredVia === undefined
          ? {}
          : { recoveredVia: cited.recoveredVia }),
      },
      fields: {
        autofillId: valueField(rowId),
        fieldName,
        fieldValue,
        fieldValueLower: preservedString(get("value_lower")),
        timesUsed: preservedInteger(get("count")),
        dateCreated,
        dateLastUsed,
      },
    });
    return {
      finding,
      searchText: [profile, textValue(fieldName), textValue(fieldValue)]
        .join("\n")
        .toLocaleLowerCase("en-US"),
      sortCreated: timeValue(dateCreated),
      sortLastUsed: timeValue(dateLastUsed),
      sortName: textValue(fieldName) || null,
      sortValue: textValue(fieldValue) || null,
    };
  });
}

function unavailableArtifact(
  header: SqliteArtifactHeader,
): WebDataArtifactWrite {
  return {
    ...header,
    findings: [],
    committedFieldCount: 0,
    recoveredFieldCount: 0,
  };
}

export async function analyseWebDataProfile(options: {
  readonly source: CaseSourceRecord;
  readonly profile: string;
  readonly workingCopyPath: string;
  readonly declaredTimezone: string;
}): Promise<WebDataArtifactWrite> {
  const resolved = resolveProfileDatabase({
    ...options,
    label: "web_data",
    relativePaths: ["Web Data"],
  });
  if (!resolved.readable) {
    return unavailableArtifact(resolved.header);
  }
  const { target } = resolved;
  try {
    const passes = await readWebDataPasses(target);
    const cited = citedPasses(target, passes);
    const build = (pass: CitedPass<WebDataPass>): PersistedAutofillFinding[] =>
      buildAutofillEntries(pass, options.profile, options.declaredTimezone);
    const committed = build(cited.committed);
    const recovered = cited.recovered === null ? [] : build(cited.recovered);
    return {
      ...completeArtifactHeader(target, passes),
      findings: [...committed, ...recovered],
      committedFieldCount: committed.length,
      recoveredFieldCount: recovered.length,
    };
  } catch (error) {
    return unavailableArtifact(readFailureHeader(target, "web_data", error));
  }
}
