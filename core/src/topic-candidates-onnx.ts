import { existsSync } from "node:fs";
import { join } from "node:path";

import type {
  EmbeddingEngine,
  TopicClassifierUnavailable,
} from "./topic-candidates.js";

/**
 * The settled local ONNX topic engine.
 *
 * The model is `minishlab/potion-base-8M` (Model2Vec / EmbeddingBag), pinned by
 * revision and selected by the classifier bench: a static embedding with a
 * permissive MIT licence, a ~30 MB footprint, and — decisively for a forensic
 * tool — cross-architecture decision parity. Inference is a single
 * ONNX pass (`input_ids` + `offsets` -> one L2-normalised vector); topic scores
 * are the cosine similarity of that vector to the frozen label anchors.
 *
 * INVARIANTS enforced here:
 *   - No runtime network. The runtime and the model bytes are loaded from disk;
 *     nothing is fetched. The tokeniser is created with `local_files_only`.
 *   - No Python, no pickle, no second analysis process. `onnxruntime-node` runs
 *     in-process; the `.sav` pickle path from ForensiX v1 is gone.
 *   - Determinism. The session is single-threaded with basic graph optimisation,
 *     the control the bench identified for bitwise cross-host divergence.
 *
 * The runtime (`onnxruntime-node`) and tokeniser (`@huggingface/transformers`)
 * are OPTIONAL: they are loaded through a dynamic import guarded by try/catch, so
 * a deployment without them — including this repository's default install — gets
 * a typed {@link TopicClassifierUnavailable} rather than a crash, and History
 * analysis stays fully usable. When they are present alongside the model
 * directory, the same code path produces real classifications.
 */

export const TOPIC_MODEL_ID = "minishlab/potion-base-8M" as const;
export const TOPIC_MODEL_REVISION =
  "bf8b056651a2c21b8d2565580b8569da283cab23" as const;
export const TOPIC_MODEL_DIR_ENV = "FORENSIX_TOPIC_MODEL_DIR" as const;
const MODEL_FILE = join("onnx", "model.onnx");
const MAX_LENGTH = 512;

interface OrtTensorLike {
  readonly data: ArrayLike<number>;
}
interface OrtSessionLike {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensorLike>>;
}
interface OrtModuleLike {
  readonly InferenceSession: {
    create(path: string, options: unknown): Promise<OrtSessionLike>;
  };
  readonly Tensor: new (
    type: string,
    data: BigInt64Array,
    dims: readonly number[],
  ) => unknown;
}
type TokenizerFn = (
  text: string,
  options: Record<string, unknown>,
) => { input_ids?: { data?: ArrayLike<number> } | ArrayLike<number> };

// Loaded through non-literal specifiers so the type-checker does not try to
// resolve the optional native modules at build time.
async function optionalImport(specifier: string): Promise<unknown> {
  return import(specifier);
}

function resolveModelDir(explicit?: string): string | null {
  const dir = explicit ?? process.env[TOPIC_MODEL_DIR_ENV];
  if (dir === undefined || dir.trim() === "") {
    return null;
  }
  return dir;
}

function extractIds(encoded: ReturnType<TokenizerFn>): number[] {
  const ids = encoded.input_ids;
  if (ids === undefined) {
    throw new Error("Tokenizer produced no input_ids.");
  }
  if (typeof ids === "object" && "data" in ids && ids.data !== undefined) {
    return Array.from(ids.data, Number);
  }
  return Array.from(ids as ArrayLike<number>, Number);
}

export interface LoadTopicEngineOptions {
  /** Model directory. Falls back to the FORENSIX_TOPIC_MODEL_DIR env var. */
  readonly modelDir?: string;
}

/**
 * Load the settled ONNX topic engine, or explain — with a typed reason — why it
 * is unavailable. Never throws for an absent runtime or model; those are
 * expected, recorded states, not failures.
 */
export async function loadTopicEngine(
  options: LoadTopicEngineOptions = {},
): Promise<EmbeddingEngine | TopicClassifierUnavailable> {
  const modelDir = resolveModelDir(options.modelDir);
  if (modelDir === null || !existsSync(join(modelDir, MODEL_FILE))) {
    return { available: false, reason: "model_artifact_missing" };
  }

  let ort: OrtModuleLike;
  let AutoTokenizer: {
    from_pretrained(dir: string, options: unknown): Promise<TokenizerFn>;
  };
  try {
    ort = (await optionalImport("onnxruntime-node")) as OrtModuleLike;
    const transformers = (await optionalImport(
      "@huggingface/transformers",
    )) as {
      AutoTokenizer: typeof AutoTokenizer;
      env: { allowRemoteModels: boolean; allowLocalModels: boolean };
    };
    transformers.env.allowRemoteModels = false;
    transformers.env.allowLocalModels = true;
    AutoTokenizer = transformers.AutoTokenizer;
  } catch (error) {
    return {
      available: false,
      reason: "model_runtime_unavailable",
      detail: String(error),
    };
  }

  try {
    const modelPath = join(modelDir, MODEL_FILE);
    const tokenizer = await AutoTokenizer.from_pretrained(modelDir, {
      local_files_only: true,
    });
    const session = await ort.InferenceSession.create(modelPath, {
      executionProviders: ["cpu"],
      graphOptimizationLevel: "basic",
      intraOpNumThreads: 1,
      interOpNumThreads: 1,
      enableCpuMemArena: false,
      enableMemPattern: false,
    });

    const embed = async (text: string): Promise<Float32Array> => {
      const encoded = tokenizer(text, {
        padding: false,
        truncation: true,
        max_length: MAX_LENGTH,
      });
      const parsed = extractIds(encoded);
      const ids = parsed.length > 0 ? parsed : [0];
      const feeds: Record<string, unknown> = {};
      for (const name of session.inputNames) {
        if (name === "input_ids") {
          feeds[name] = new ort.Tensor(
            "int64",
            BigInt64Array.from(ids, (value) => BigInt(value)),
            [ids.length],
          );
        } else if (name === "offsets") {
          feeds[name] = new ort.Tensor("int64", BigInt64Array.from([0n]), [1]);
        } else {
          throw new Error(`Unhandled ONNX input "${name}".`);
        }
      }
      const output = await session.run(feeds);
      const outputName = session.outputNames[0];
      const first = outputName === undefined ? undefined : output[outputName];
      if (first === undefined) {
        throw new Error("ONNX session produced no output.");
      }
      return Float32Array.from(first.data, Number);
    };

    return {
      modelId: TOPIC_MODEL_ID,
      modelRevision: TOPIC_MODEL_REVISION,
      embed,
    };
  } catch (error) {
    return {
      available: false,
      reason: "model_load_failed",
      detail: String(error),
    };
  }
}
