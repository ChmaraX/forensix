import type { PersistedCandidate } from "./case-findings.js";
import {
  absentField,
  createCandidate,
  valueField,
  type CommitState,
  type Provenance,
} from "./forensic-model.js";

/**
 * Topic classification as Candidates — never Findings.
 *
 * This module classifies the topic of a browsing row (URL + title) into a
 * frozen 20-label taxonomy and emits the result as nominal, ranked
 * {@link Candidate} records. A Candidate is deliberately NOT a Finding: it is a
 * ranked hypothesis carrying a supporting count and a resolvable Provenance,
 * and the product never promotes it into a Finding collection or a factual
 * summary tile. The separation is enforced structurally — this module only ever
 * constructs `createCandidate(...)` rows and writes them to the
 * `forensic_candidates` store, which is a distinct table from every
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

export interface TopicLabel {
  readonly id: string;
  readonly name: string;
  /** The forensic question the label answers. Frozen supervision. */
  readonly question: string;
  /** The label's boundary rule. Frozen supervision. */
  readonly boundary: string;
  /** GDPR Article 9 special-category label (reported with extra care). */
  readonly specialCategory: boolean;
}

/**
 * The frozen 20-label taxonomy. The `name`, `question`, and `boundary` fields
 * are the ONLY supervision the model-backed classifier receives; they are copied
 * verbatim from the taxonomy proposal (ChmaraX/forensix#137 §3), which was
 * written and frozen BEFORE any fixture was labelled. `unclassified` is a real,
 * mandatory member of the set: a forensic classifier must be permitted to say
 * nothing. Any change to these strings must be justified against the proposal,
 * never against measured performance.
 */
export const TOPIC_TAXONOMY: readonly TopicLabel[] = Object.freeze([
  {
    id: "search_query",
    name: "Search & Query",
    question: "What did the subject look for, in their own words?",
    boundary:
      "Applies to search-engine result pages and to in-site search endpoints.",
    specialCategory: false,
  },
  {
    id: "webmail_messaging_voice",
    name: "Webmail, Messaging & Voice",
    question: "How were they communicating off-channel?",
    boundary:
      "Web-hosted mail, chat, messaging and voice/meeting services. The label asserts the channel, never the conversation.",
    specialCategory: false,
  },
  {
    id: "social_media",
    name: "Social media & Online communities",
    question: "What accounts and what contacts?",
    boundary:
      "Social networks, forums, community platforms, professional networks, personal blogs, and dating services.",
    specialCategory: false,
  },
  {
    id: "news_current_affairs",
    name: "News & Current affairs",
    question:
      "What was the subject reading about, and when relative to the incident?",
    boundary: "Press, broadcast news, aggregators.",
    specialCategory: false,
  },
  {
    id: "reference_education_howto",
    name: "Reference, Education & How-to",
    question: "Was the subject learning or researching a method?",
    boundary:
      "Encyclopaedic and reference material, courses, academic and institutional sites, instructional material.",
    specialCategory: false,
  },
  {
    id: "entertainment_streaming_gaming",
    name: "Entertainment, Streaming & Gaming",
    question:
      "How much of this history is leisure consumption, and when did it happen?",
    boundary:
      "Video and audio streaming, music, film and TV, humour, celebrity, comics, sport as spectacle, and games.",
    specialCategory: false,
  },
  {
    id: "technology_software_dev",
    name: "Technology, Software & Developer resources",
    question: "Was the subject working, or acquiring capability?",
    boundary:
      "Vendor and product documentation, developer platforms, package and code hosting, IT, SaaS and admin consoles, AI services.",
    specialCategory: false,
  },
  {
    id: "shopping_marketplace",
    name: "Shopping & Marketplace",
    question: "What was purchased, and does it match the alleged fraud?",
    boundary:
      "Retail, auctions, classifieds, marketplaces, coupons, and property listings.",
    specialCategory: false,
  },
  {
    id: "finance_banking",
    name: "Finance & Banking",
    question:
      "Which financial institutions and accounts were accessed, and when?",
    boundary:
      "Retail and commercial banking, payments, brokerage, insurance, tax and government financial portals, accounting.",
    specialCategory: false,
  },
  {
    id: "cryptocurrency_exchanges",
    name: "Cryptocurrency & Exchanges",
    question: "Was there an exfil-monetisation or ransom-payment channel?",
    boundary:
      "Exchanges, wallets, chain explorers, mining and token services. Kept separate from Finance & Banking deliberately.",
    specialCategory: false,
  },
  {
    id: "employment_job_seeking",
    name: "Employment & Job seeking",
    question: "Was there job-seeking before the exfil?",
    boundary: "Job boards, applicant portals, recruiter services, CV tooling.",
    specialCategory: false,
  },
  {
    id: "travel_transport_accommodation",
    name: "Travel, Transport & Accommodation",
    question: "Does the browsing corroborate the movement timeline?",
    boundary:
      "Booking, carriers, accommodation, maps and routing, local transport.",
    specialCategory: false,
  },
  {
    id: "health_medical",
    name: "Health & Medical",
    question:
      "Is there a medical explanation, a capacity question, or a welfare concern?",
    boundary:
      "Conditions, symptoms, providers, appointments, pharmacy, mental-health services.",
    specialCategory: true,
  },
  {
    id: "adult_sexual_content",
    name: "Adult & Sexual content",
    question: "Was there adult material on this machine?",
    boundary:
      "Explicitly not a CSAM detector. Does not extend to dating, sex education, or non-sexual nudity.",
    specialCategory: true,
  },
  {
    id: "gambling",
    name: "Gambling",
    question: "Was there gambling activity?",
    boundary: "Betting, casino, lottery, and in-game wagering.",
    specialCategory: false,
  },
  {
    id: "file_sharing_cloud_storage",
    name: "File sharing, Cloud storage & Transfer",
    question: "How did the data leave?",
    boundary:
      "Consumer and enterprise cloud storage, document collaboration, large-file transfer, peer-to-peer, paste services.",
    specialCategory: false,
  },
  {
    id: "anonymity_privacy_tooling",
    name: "Anonymity & Privacy tooling",
    question: "Was there counter-forensic preparation?",
    boundary:
      "VPN, Tor and proxy services, encrypted-DNS services, anonymous mail, secure-delete and anti-forensic tooling.",
    specialCategory: false,
  },
  {
    id: "hacking_security_tooling",
    name: "Hacking & Security tooling",
    question: "Was there tool acquisition or capability building?",
    boundary:
      "Offensive tooling, exploit and vulnerability material, credential-attack resources, malware analysis resources.",
    specialCategory: false,
  },
  {
    id: "ads_trackers_infrastructure",
    name: "Ads, Trackers & Web infrastructure",
    question: "Which of these rows record an act by the user at all?",
    boundary:
      "Advertising and tracking beacons, CDN hosts, URL shorteners and redirect hops, parked domains, consent walls, browser-internal pages.",
    specialCategory: false,
  },
  {
    id: "unclassified",
    name: "Unclassified / insufficient signal",
    question: "Can this row support any claim?",
    boundary:
      "The row's title and URL together carry no discriminating signal. A forensic classifier must be permitted to say nothing.",
    specialCategory: false,
  },
]);

export const UNCLASSIFIED_LABEL_ID = "unclassified" as const;

/** Provenance of the frozen supervision text, recorded for auditability. */
export const TOPIC_TAXONOMY_SOURCE =
  "ChmaraX/forensix#137 section 3 (label set + forensic question + boundary rules), frozen before labelling" as const;

const TOPIC_LABELS_BY_ID: ReadonlyMap<string, TopicLabel> = new Map(
  TOPIC_TAXONOMY.map((label) => [label.id, label]),
);

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

function candidateFromLabel(input: {
  readonly label: TopicLabel;
  readonly rank: number;
  readonly score: number;
  readonly url: string | null;
  readonly title: string | null;
  readonly engine: Pick<EmbeddingEngine, "modelId" | "modelRevision">;
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

/**
 * A blank input carries no discriminating signal. Rather than fabricate a
 * confident topic, emit exactly one `unclassified` Candidate with the same
 * Provenance and supporting count. No engine call is needed.
 */
function unclassifiedCandidate(
  source: TopicCandidateInput,
  engine: Pick<EmbeddingEngine, "modelId" | "modelRevision">,
): PersistedCandidate {
  const label = TOPIC_LABELS_BY_ID.get(UNCLASSIFIED_LABEL_ID);
  if (label === undefined) {
    throw new Error("Taxonomy is missing the mandatory unclassified label.");
  }
  return candidateFromLabel({
    label,
    rank: 1,
    score: 0,
    url: source.url === null || source.url.trim() === "" ? null : source.url,
    title:
      source.title === null || source.title.trim() === "" ? null : source.title,
    engine,
    source,
  });
}

/**
 * Classify a batch of browsing rows into ranked topic Candidates.
 *
 * Every returned row is a nominal Candidate with a rank, a supporting count, and
 * a resolvable Provenance. Blank inputs yield a single `unclassified` Candidate.
 * If the engine throws at any point (anchor embedding or row inference) the whole
 * batch resolves to a typed {@link TopicClassifierUnavailable} and the caller
 * keeps its Findings untouched — History analysis stays usable.
 */
export async function classifyTopicCandidates(
  engine: EmbeddingEngine,
  inputs: readonly TopicCandidateInput[],
  options: TopicClassifierOptions = {},
): Promise<PersistedCandidate[] | TopicClassifierUnavailable> {
  const maxLabels = options.maxLabels ?? DEFAULT_MAX_LABELS;
  const multiLabelDelta = options.multiLabelDelta ?? DEFAULT_MULTI_LABEL_DELTA;
  const engineIdentity = {
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

  const candidates: PersistedCandidate[] = [];
  try {
    for (const input of inputs) {
      const text = topicInputText(input.url, input.title);
      if (text.length === 0) {
        candidates.push(unclassifiedCandidate(input, engineIdentity));
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
            url:
              input.url === null || input.url.trim() === "" ? null : input.url,
            title:
              input.title === null || input.title.trim() === ""
                ? null
                : input.title,
            engine: engineIdentity,
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
}
