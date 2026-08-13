import {
  FindingCollection,
  createCandidate,
  createFinding,
  valueField,
  type Finding,
  type Provenance,
} from "../src/index.js";

const provenance: Provenance = {
  manifestEntryId: "source-1:4",
  sourceId: "source-1",
  manifestEntryOrdinal: 4,
  manifestPath: "Default/History",
  database: "Default/History",
  table: "visits",
  rowId: "1",
};

const finding = createFinding({
  findingKind: "history_visit",
  profile: "Default",
  commitState: "committed",
  provenance,
  fields: { url: valueField("https://example.test/") },
});
const candidate = createCandidate({
  candidateKind: "browsing_topic",
  rank: 1,
  count: 1,
  provenance,
  fields: { topic: valueField("example") },
});

const findings = new FindingCollection<Finding>();
findings.add(finding);

// @ts-expect-error A Candidate can never enter a Finding collection.
findings.add(candidate);

// @ts-expect-error Finding and Candidate are distinct nominal types.
const invalidFinding: Finding = candidate;
void invalidFinding;
