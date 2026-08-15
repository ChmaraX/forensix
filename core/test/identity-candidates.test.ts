import { describe, expect, it } from "vitest";

import type {
  HistoryArtifactWrite,
  MetadataArtifactWrite,
  WebDataArtifactWrite,
} from "../src/case-findings.js";
import {
  createFinding,
  valueField,
  type CommitState,
  type ForensicFields,
  type SourceRowProvenance,
} from "../src/forensic-model.js";
import { generateProfileCandidates } from "../src/identity-candidates.js";

const SOURCE = "SRC-1";
const PROFILE = "Default";

function provenance(
  ordinal: number,
  database: string,
  table: string,
  rowId: string,
): SourceRowProvenance {
  return {
    manifestEntryId: `${SOURCE}:${ordinal}`,
    sourceId: SOURCE,
    manifestEntryOrdinal: ordinal,
    manifestPath: database,
    database,
    table,
    rowId,
  };
}

function autofill(
  rowId: string,
  name: string,
  value: string,
  commitState: CommitState = "committed",
): { readonly finding: ReturnType<typeof createFinding> } {
  return {
    finding: createFinding({
      findingKind: "autofill_entry",
      profile: PROFILE,
      commitState,
      provenance: provenance(3, "Default/Web Data", "autofill", rowId),
      fields: {
        fieldName: valueField(name),
        fieldValue: valueField(value),
      } as ForensicFields,
    }),
  };
}

function webData(
  rows: readonly ReturnType<typeof autofill>[],
  status: WebDataArtifactWrite["status"] = "complete",
): WebDataArtifactWrite {
  return {
    sourceId: SOURCE,
    profile: PROFILE,
    status,
    manifestEntryOrdinal: 3,
    databasePath: "Default/Web Data",
    schemaVersion: 133,
    integrity: "ok",
    recoveryStatus: "unavailable",
    reason: null,
    findings: rows,
    committedFieldCount: rows.length,
    recoveredFieldCount: 0,
  };
}

function visit(
  rowId: string,
  url: string,
): { readonly finding: ReturnType<typeof createFinding> } {
  return {
    finding: createFinding({
      findingKind: "history_visit",
      profile: PROFILE,
      commitState: "committed",
      provenance: provenance(2, "Default/History", "visits", rowId),
      fields: { url: valueField(url) } as ForensicFields,
    }),
  };
}

function history(
  rows: readonly ReturnType<typeof visit>[],
  status: HistoryArtifactWrite["status"] = "complete",
): HistoryArtifactWrite {
  return {
    sourceId: SOURCE,
    profile: PROFILE,
    status,
    manifestEntryOrdinal: 2,
    databasePath: "Default/History",
    schemaVersion: 70,
    integrity: "ok",
    recoveryStatus: "unavailable",
    reason: null,
    findings: rows as never,
    candidates: [],
    committedVisitCount: rows.length,
    recoveredVisitCount: 0,
  };
}

function preferences(
  fields: ForensicFields,
  status: MetadataArtifactWrite["status"] = "complete",
): MetadataArtifactWrite {
  return {
    sourceId: SOURCE,
    profile: PROFILE,
    artifact: "Preferences",
    status,
    manifestEntryOrdinal: 4,
    databasePath: "Default/Preferences",
    reason: null,
    findings: [
      {
        finding: createFinding({
          findingKind: "profile_metadata",
          profile: PROFILE,
          commitState: "committed",
          provenance: provenance(
            4,
            "Default/Preferences",
            "preferences",
            PROFILE,
          ),
          fields,
        }),
        searchText: "",
        sortType: "profile_metadata",
        sortProfile: PROFILE,
      },
    ],
  };
}

describe("generateProfileCandidates", () => {
  it("ranks conflicting names by supporting count, then by value for ties", () => {
    const result = generateProfileCandidates({
      sourceId: SOURCE,
      profile: PROFILE,
      history: undefined,
      webData: webData([
        autofill("1", "name", "Bob"),
        autofill("2", "fullname", "Bob"),
        autofill("3", "name", "Alice"),
        autofill("4", "name", "Zoe"),
      ]),
      preferences: undefined,
      localState: undefined,
    });
    const names = result.candidates
      .map((row) => row.candidate)
      .filter((candidate) => candidate.candidateKind === "identity_name");
    // Three distinct nominal values, ranked. Conflicts are surfaced, not merged.
    expect(
      names.map((c) => [c.rank, c.count, c.fields.candidateValue]),
    ).toEqual([
      [1, 2, valueField("Bob")],
      // Alice and Zoe tie at count 1; the tie breaks by normalized value asc.
      [2, 1, valueField("Alice")],
      [3, 1, valueField("Zoe")],
    ]);
    // The winning Candidate aggregates its two source rows as Provenance.
    const [top] = names;
    expect(top?.count).toBe(2);
    expect(top?.provenance.supportingRows).toHaveLength(1);
    expect(top?.provenance.rowId).toBe("1");
  });

  it("is deterministic: identical inputs yield identical output", () => {
    const inputs = {
      sourceId: SOURCE,
      profile: PROFILE,
      history: history([
        visit("1", "https://news.example/a"),
        visit("2", "https://news.example/b"),
        visit("3", "https://shop.example/x"),
      ]),
      webData: webData([autofill("1", "email", "a@b.example")]),
      preferences: preferences({
        accountEmail: valueField("a@b.example"),
        accountFullName: valueField("A B"),
      } as ForensicFields),
      localState: undefined,
    };
    const first = JSON.stringify(generateProfileCandidates(inputs));
    const second = JSON.stringify(generateProfileCandidates(inputs));
    expect(first).toBe(second);
  });

  it("merges evidence across autofill and Preferences into one email Candidate", () => {
    const result = generateProfileCandidates({
      sourceId: SOURCE,
      profile: PROFILE,
      history: undefined,
      webData: webData([autofill("7", "email", "a@b.example")]),
      preferences: preferences({
        accountEmail: valueField("a@b.example"),
      } as ForensicFields),
      localState: undefined,
    });
    const emails = result.candidates.filter(
      (row) => row.candidate.candidateKind === "identity_email",
    );
    expect(emails).toHaveLength(1);
    expect(emails[0]?.candidate.count).toBe(2);
    expect(emails[0]?.candidate.fields.evidenceBasis).toEqual(
      valueField("autofill+preferences"),
    );
  });

  it("emits no Candidate for a heuristic with no evidence", () => {
    const result = generateProfileCandidates({
      sourceId: SOURCE,
      profile: PROFILE,
      history: undefined,
      webData: webData([autofill("1", "name", "Bob")]),
      preferences: undefined,
      localState: undefined,
    });
    expect(result.status).toBe("complete");
    expect(
      result.candidates.some(
        (row) => row.candidate.candidateKind === "identity_phone",
      ),
    ).toBe(false);
  });

  it("counts frequent hosts and search queries from committed visits", () => {
    const result = generateProfileCandidates({
      sourceId: SOURCE,
      profile: PROFILE,
      history: history([
        visit("1", "https://news.example/a"),
        visit("2", "https://news.example/b"),
        visit("3", "https://news.example/c"),
        visit("4", "https://shop.example/x"),
        visit("5", "https://www.google.com/search?q=forensics"),
      ]),
      webData: undefined,
      preferences: undefined,
      localState: undefined,
    });
    const hosts = result.candidates.filter(
      (row) => row.candidate.candidateKind === "behavior_frequent_host",
    );
    expect(hosts[0]?.candidate.fields.candidateValue).toEqual(
      valueField("news.example"),
    );
    expect(hosts[0]?.candidate.count).toBe(3);
    const searches = result.candidates.filter(
      (row) => row.candidate.candidateKind === "behavior_search_query",
    );
    expect(searches).toHaveLength(1);
    expect(searches[0]?.candidate.fields.candidateValue).toEqual(
      valueField("forensics"),
    );
  });

  it("marks the artifact unavailable when every input is unavailable", () => {
    const result = generateProfileCandidates({
      sourceId: SOURCE,
      profile: PROFILE,
      history: history([], "unavailable"),
      webData: webData([], "unavailable"),
      preferences: undefined,
      localState: undefined,
    });
    expect(result.status).toBe("unavailable");
    expect(result.candidates).toHaveLength(0);
  });

  it("still produces Candidates from available inputs and names the unavailable ones", () => {
    const result = generateProfileCandidates({
      sourceId: SOURCE,
      profile: PROFILE,
      history: undefined,
      webData: webData([], "unavailable"),
      preferences: preferences({
        accountFullName: valueField("A B"),
      } as ForensicFields),
      localState: undefined,
    });
    expect(result.status).toBe("complete");
    expect(result.reason).toContain("web_data_unavailable");
    expect(
      result.candidates.some(
        (row) => row.candidate.candidateKind === "identity_name",
      ),
    ).toBe(true);
  });

  it("reports absent when no input is present at all", () => {
    const result = generateProfileCandidates({
      sourceId: SOURCE,
      profile: PROFILE,
      history: undefined,
      webData: undefined,
      preferences: undefined,
      localState: undefined,
    });
    expect(result.status).toBe("absent");
    expect(result.candidates).toHaveLength(0);
  });
});
