import type { PersistedCandidate } from "./case-findings.js";
import {
  absentField,
  createCandidate,
  valueField,
  type CommitState,
  type Provenance,
} from "./forensic-model.js";
import {
  TOPIC_LABELS_BY_ID,
  TOPIC_TAXONOMY,
  UNCLASSIFIED_LABEL_ID,
  type TopicLabel,
} from "./topic-taxonomy.js";

/**
 * Topic classification as Candidates — never Findings.
 *
 * This module classifies the topic of a browsing row (URL + title) into the
 * frozen 20-label taxonomy (see `topic-taxonomy.ts`) and emits the result as
 * nominal, ranked {@link Candidate} records. A Candidate is deliberately NOT a
 * Finding: it is a ranked hypothesis carrying a supporting count and a
 * resolvable Provenance, and the product never promotes it into a Finding
 * collection or a factual summary tile. The separation is enforced structurally
 * — this module only ever constructs `createCandidate(...)` rows and writes them
 * to the `forensic_candidates` store, which is a distinct table from every
 * `*_findings` table.
 *
 * The classifier is engine-injected. The production engine is the settled local
 * ONNX model (see `topic-candidates-onnx.ts`); this module contains no model
 * runtime, no network access, no Python, and no second analysis process. All
 * decision logic here is pure and deterministic given an engine, so the behaviour
 * that lands in the Case can be tested without the model binary present.
 */

const CANDIDATE_KIND = "topic" as const;
export const TOPIC_CANDIDATE_KIND = CANDIDATE_KIND;

export {
  TOPIC_TAXONOMY,
  TOPIC_TAXONOMY_SOURCE,
  UNCLASSIFIED_LABEL_ID,
  type TopicLabel,
} from "./topic-taxonomy.js";

/**
 * A single-pass text encoder. The classifier only needs to turn a string into a
 * vector; every model detail (tokeniser, ONNX session, pooling) is the engine's
 * concern. Vectors are expected L2-normalised so that a dot product is cosine
 * similarity, but the classifier re-normalises defensively.
 */
export interface EmbeddingEngine {
  readonly modelId: string;
  readonly modelRevision: string;
  readonly embed: (text: string) => Promise<Float32Array>;
}

export type TopicClassifierUnavailableReason =
  | "model_runtime_unavailable"
  | "model_artifact_missing"
  | "model_load_failed"
  | "inference_failed";

export interface TopicClassifierUnavailable {
  readonly available: false;
  readonly reason: TopicClassifierUnavailableReason;
  readonly detail?: string;
}

export interface TopicCandidateInput {
  readonly url: string | null;
  readonly title: string | null;
  readonly profile: string;
  readonly commitState: CommitState;
  readonly provenance: Provenance;
  /** Number of source rows (browsing visits) this input summarises. >= 1. */
  readonly supportingCount: number;
}

export interface TopicClassifierOptions {
  /** Maximum labels emitted per input. Default 3. */
  readonly maxLabels?: number;
  /**
   * Emit every label whose cosine score is within this delta of the top label
   * (multi-label emission). Default 0.02, the settled bench band.
   */
  readonly multiLabelDelta?: number;
}

/**
 * A classifier with its label anchors already embedded. Anchors depend only on
 * the engine, so they are computed once here rather than per input batch; this
 * also makes the failure boundary honest — anchor-embedding failure surfaces
 * when the classifier is prepared, per-row inference failure surfaces from
 * {@link classifyBatch}.
 */
export interface PreparedTopicClassifier {
  readonly modelId: string;
  readonly modelRevision: string;
  readonly classifyBatch: (
    inputs: readonly TopicCandidateInput[],
    options?: TopicClassifierOptions,
  ) => Promise<PersistedCandidate[] | TopicClassifierUnavailable>;
}

const DEFAULT_MAX_LABELS = 3;
const DEFAULT_MULTI_LABEL_DELTA = 0.02;
const SCORE_PRECISION = 1_000_000;

/** Compose the encoder input from a browsing row. Title precedes URL. */
export function topicInputText(
  url: string | null,
  title: string | null,
): string {
  return [title, url]
    .map((part) => (part ?? "").trim())
    .filter((part) => part.length > 0)
    .join(" ");
}

function l2normalise(vector: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < vector.length; i += 1) {
    const value = vector[i] as number;
    sum += value * value;
  }
  const norm = Math.sqrt(sum);
  if (norm === 0) {
    return vector;
  }
  const out = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i += 1) {
    out[i] = (vector[i] as number) / norm;
  }
  return out;
}

function dot(a: Float32Array, b: Float32Array): number {
  const length = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < length; i += 1) {
    sum += (a[i] as number) * (b[i] as number);
  }
  return sum;
}

function anchorText(label: TopicLabel): string {
  return [label.name, label.question, label.boundary]
    .filter((part) => part.length > 0)
    .join(". ");
}

function roundScore(score: number): number {
  return Math.round(score * SCORE_PRECISION) / SCORE_PRECISION;
}

interface RankedLabel {
  readonly labelId: string;
  readonly score: number;
}

/**
 * Rank labels by score, tie-broken by label id so two runs — and two CPU
 * architectures — cannot disagree on the order of equal scores. This is the
 * deterministic decision surface the Case records.
 */
function rankLabels(scores: ReadonlyMap<string, number>): RankedLabel[] {
  return [...scores.entries()]
    .map(([labelId, score]) => ({ labelId, score: roundScore(score) }))
    .sort((a, b) =>
      b.score !== a.score
        ? b.score - a.score
        : a.labelId < b.labelId
          ? -1
          : a.labelId > b.labelId
            ? 1
            : 0,
    );
}

function selectEmittedLabels(
  ranked: readonly RankedLabel[],
  maxLabels: number,
  multiLabelDelta: number,
): RankedLabel[] {
  const top = ranked[0];
  if (top === undefined) {
    return [];
  }
  let emitted = ranked.filter(
    (label) => top.score - label.score <= multiLabelDelta,
  );
  // `unclassified` asserts the absence of signal; it cannot co-occur with a
  // positive label. Mirrors the taxonomy's mutual-exclusivity rule.
  if (emitted.length > 1) {
    const positives = emitted.filter(
      (label) => label.labelId !== UNCLASSIFIED_LABEL_ID,
    );
    if (positives.length > 0) {
      emitted = positives;
    }
  }
  return emitted.slice(0, Math.max(1, maxLabels));
}

type EngineIdentity = Pick<EmbeddingEngine, "modelId" | "modelRevision">;

function candidateFromLabel(input: {
  readonly label: TopicLabel;
  readonly rank: number;
  readonly score: number;
  readonly url: string | null;
  readonly title: string | null;
  readonly engine: EngineIdentity;
  readonly source: TopicCandidateInput;
}): PersistedCandidate {
  const candidate = createCandidate({
    candidateKind: CANDIDATE_KIND,
    rank: input.rank,
    count: input.source.supportingCount,
    provenance: input.source.provenance,
    fields: {
      topicLabel: valueField(input.label.id),
      topicName: valueField(input.label.name),
      specialCategory: valueField(input.label.specialCategory),
      score: valueField(roundScore(input.score), { synthetic: true }),
      scoreAxis: valueField("cosine", { synthetic: true }),
      modelId: valueField(input.engine.modelId, { synthetic: true }),
      modelRevision: valueField(input.engine.modelRevision, {
        synthetic: true,
      }),
      url: input.url === null ? absentField() : valueField(input.url),
      title: input.title === null ? absentField() : valueField(input.title),
    },
  });
  const searchText = [
    input.source.profile,
    input.label.id,
    input.label.name,
    input.url ?? "",
    input.title ?? "",
  ]
    .join("\n")
    .toLocaleLowerCase("en-US");
  return {
    candidate,
    profile: input.source.profile,
    commitState: input.source.commitState,
    searchText,
  };
}

function nonBlank(value: string | null): string | null {
  return value === null || value.trim() === "" ? null : value;
}

/**
 * A blank input carries no discriminating signal. Rather than fabricate a
 * confident topic, emit exactly one `unclassified` Candidate with the same
 * Provenance and supporting count. No engine call is needed.
 */
function unclassifiedCandidate(
  source: TopicCandidateInput,
  engine: EngineIdentity,
): PersistedCandidate {
  const label = TOPIC_LABELS_BY_ID.get(UNCLASSIFIED_LABEL_ID);
  if (label === undefined) {
    throw new Error("Taxonomy is missing the mandatory unclassified label.");
  }
  return candidateFromLabel({
    label,
    rank: 1,
    score: 0,
    url: nonBlank(source.url),
    title: nonBlank(source.title),
    engine,
    source,
  });
}

/**
 * Prepare a classifier by embedding the label anchors once. Anchors depend only
 * on the engine, so a caller that classifies many artifact batches embeds them a
 * single time. Returns a typed {@link TopicClassifierUnavailable} if the engine
 * throws while embedding anchors — that is a model failure, not a per-row one.
 */
export async function createTopicClassifier(
  engine: EmbeddingEngine,
): Promise<PreparedTopicClassifier | TopicClassifierUnavailable> {
  const identity: EngineIdentity = {
    modelId: engine.modelId,
    modelRevision: engine.modelRevision,
  };
  let anchors: { label: TopicLabel; vector: Float32Array }[];
  try {
    anchors = [];
    for (const label of TOPIC_TAXONOMY) {
      if (label.id === UNCLASSIFIED_LABEL_ID) {
        continue;
      }
      anchors.push({
        label,
        vector: l2normalise(await engine.embed(anchorText(label))),
      });
    }
  } catch (error) {
    return {
      available: false,
      reason: "inference_failed",
      detail: String(error),
    };
  }

  const classifyBatch = async (
    inputs: readonly TopicCandidateInput[],
    options: TopicClassifierOptions = {},
  ): Promise<PersistedCandidate[] | TopicClassifierUnavailable> => {
    const maxLabels = options.maxLabels ?? DEFAULT_MAX_LABELS;
    const multiLabelDelta =
      options.multiLabelDelta ?? DEFAULT_MULTI_LABEL_DELTA;
    const candidates: PersistedCandidate[] = [];
    try {
      for (const input of inputs) {
        const text = topicInputText(input.url, input.title);
        if (text.length === 0) {
          candidates.push(unclassifiedCandidate(input, identity));
          continue;
        }
        const vector = l2normalise(await engine.embed(text));
        const scores = new Map<string, number>();
        for (const anchor of anchors) {
          scores.set(anchor.label.id, dot(vector, anchor.vector));
        }
        const ranked = rankLabels(scores);
        const emitted = selectEmittedLabels(ranked, maxLabels, multiLabelDelta);
        emitted.forEach((entry, index) => {
          const label = TOPIC_LABELS_BY_ID.get(entry.labelId);
          if (label === undefined) {
            return;
          }
          candidates.push(
            candidateFromLabel({
              label,
              rank: index + 1,
              score: entry.score,
              url: nonBlank(input.url),
              title: nonBlank(input.title),
              engine: identity,
              source: input,
            }),
          );
        });
      }
    } catch (error) {
      return {
        available: false,
        reason: "inference_failed",
        detail: String(error),
      };
    }
    return candidates;
  };

  return { ...identity, classifyBatch };
}

/**
 * Classify a batch of browsing rows into ranked topic Candidates.
 *
 * Every returned row is a nominal Candidate with a rank, a supporting count, and
 * a resolvable Provenance. Blank inputs yield a single `unclassified` Candidate.
 * If the engine throws at any point (anchor embedding or row inference) the whole
 * batch resolves to a typed {@link TopicClassifierUnavailable} and the caller
 * keeps its Findings untouched — History analysis stays usable.
 *
 * This is a one-shot convenience over {@link createTopicClassifier}; a caller
 * classifying several batches should prepare once and reuse the result so the
 * anchors are embedded a single time.
 */
export async function classifyTopicCandidates(
  engine: EmbeddingEngine,
  inputs: readonly TopicCandidateInput[],
  options: TopicClassifierOptions = {},
): Promise<PersistedCandidate[] | TopicClassifierUnavailable> {
  const prepared = await createTopicClassifier(engine);
  if ("available" in prepared) {
    return prepared;
  }
  return prepared.classifyBatch(inputs, options);
}
