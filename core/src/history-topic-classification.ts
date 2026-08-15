import type { HistoryArtifactWrite } from "./case-findings.js";
import {
  createTopicClassifier,
  type EmbeddingEngine,
  type TopicCandidateInput,
  type TopicClassifierUnavailableReason,
} from "./topic-candidates.js";
import { loadTopicEngine } from "./topic-candidates-onnx.js";

/**
 * The topic-classification pass for History analysis, kept out of the History
 * orchestrator: it is a self-contained topic-domain concern that reads the
 * already-built distinct-URL summary Findings and attaches ranked Candidates.
 * It never writes a Finding, so disabling it leaves every source artifact row
 * byte-for-byte unchanged.
 */

export interface TopicClassificationSetting {
  readonly enabled?: boolean;
  /** Inject an engine (tests, alternate deployments). Overrides the loader. */
  readonly engine?: EmbeddingEngine;
}

/**
 * Outcome of the local topic classifier. `disabled` and every `unavailable`
 * reason are first-class recorded states: the History analysis is complete and
 * queryable regardless, and no classifier output is ever a Finding.
 */
export interface TopicCandidateSummary {
  readonly status: "complete" | "disabled" | "unavailable";
  readonly reason: TopicClassifierUnavailableReason | null;
  readonly classifiedUrlCount: number;
  readonly candidateCount: number;
  readonly modelId: string | null;
  readonly modelRevision: string | null;
}

type EngineIdentity = {
  readonly modelId: string;
  readonly modelRevision: string;
};

function disabledSummary(): TopicCandidateSummary {
  return {
    status: "disabled",
    reason: null,
    classifiedUrlCount: 0,
    candidateCount: 0,
    modelId: null,
    modelRevision: null,
  };
}

function unavailableSummary(
  reason: TopicClassifierUnavailableReason,
  engine?: EngineIdentity,
): TopicCandidateSummary {
  return {
    status: "unavailable",
    reason,
    classifiedUrlCount: 0,
    candidateCount: 0,
    modelId: engine?.modelId ?? null,
    modelRevision: engine?.modelRevision ?? null,
  };
}

function completeSummary(
  engine: EngineIdentity,
  classifiedUrlCount: number,
  candidateCount: number,
): TopicCandidateSummary {
  return {
    status: "complete",
    reason: null,
    classifiedUrlCount,
    candidateCount,
    modelId: engine.modelId,
    modelRevision: engine.modelRevision,
  };
}

function topicInputsFromArtifact(
  artifact: HistoryArtifactWrite,
): TopicCandidateInput[] {
  const inputs: TopicCandidateInput[] = [];
  // Classification consumes the already-built distinct-URL summaries. It reads
  // Findings but never writes them: the summary Findings are identical whether
  // or not the classifier runs, so disabling classification cannot perturb a
  // single source artifact row.
  for (const persisted of artifact.findings) {
    const finding = persisted.finding;
    if (finding.findingKind !== "history_most_visited_summary") {
      continue;
    }
    const urlField = finding.fields.url;
    const titleField = finding.fields.title;
    const countField = finding.fields.supportingVisitCount;
    const url =
      urlField !== undefined && urlField.state === "value"
        ? String(urlField.value)
        : null;
    const title =
      titleField !== undefined && titleField.state === "value"
        ? String(titleField.value)
        : null;
    const rawCount =
      countField !== undefined && countField.state === "value"
        ? Number(countField.value)
        : 1;
    inputs.push({
      url,
      title,
      profile: finding.profile,
      commitState: finding.commitState,
      provenance: finding.provenance,
      supportingCount:
        Number.isSafeInteger(rawCount) && rawCount >= 1 ? rawCount : 1,
    });
  }
  return inputs;
}

export async function classifyHistoryTopics(
  artifacts: readonly HistoryArtifactWrite[],
  setting: TopicClassificationSetting | undefined,
): Promise<{
  readonly artifacts: readonly HistoryArtifactWrite[];
  readonly summary: TopicCandidateSummary;
}> {
  if ((setting?.enabled ?? true) === false) {
    return { artifacts, summary: disabledSummary() };
  }
  const engineOrUnavailable = setting?.engine ?? (await loadTopicEngine());
  if ("available" in engineOrUnavailable) {
    return {
      artifacts,
      summary: unavailableSummary(engineOrUnavailable.reason),
    };
  }
  // Prepare the classifier once: the label anchors depend only on the engine,
  // so embedding them per artifact would be wasted work. Anchor-embedding
  // failure surfaces here as a typed unavailability.
  const prepared = await createTopicClassifier(engineOrUnavailable);
  if ("available" in prepared) {
    return {
      artifacts,
      summary: unavailableSummary(prepared.reason, engineOrUnavailable),
    };
  }
  const withCandidates: HistoryArtifactWrite[] = [];
  let classifiedUrlCount = 0;
  let candidateCount = 0;
  for (const artifact of artifacts) {
    if (artifact.status !== "complete") {
      withCandidates.push(artifact);
      continue;
    }
    const inputs = topicInputsFromArtifact(artifact);
    classifiedUrlCount += inputs.length;
    const result = await prepared.classifyBatch(inputs);
    if (!Array.isArray(result)) {
      // An inference failure keeps every Finding intact: return the original
      // artifacts with no Candidates attached and a typed reason.
      return {
        artifacts,
        summary: unavailableSummary(result.reason, prepared),
      };
    }
    candidateCount += result.length;
    withCandidates.push({ ...artifact, candidates: result });
  }
  return {
    artifacts: withCandidates,
    summary: completeSummary(prepared, classifiedUrlCount, candidateCount),
  };
}
