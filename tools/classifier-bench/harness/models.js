'use strict';
// The pinned model registry, shared by Phase A (download) and Phase B (bench).
//
// Every repository is pinned by COMMIT REVISION, not `main`. The previous
// download script fetched `/resolve/main/`, which is a moving target: a new
// upstream commit would silently change every number in results.json. With a
// revision pin plus the SHA-256 check in expected_artifacts.json, upstream drift
// becomes a hard failure instead of a quiet one.

const MODELS = [
  {
    id: 'minishlab/potion-base-2M',
    dir: 'potion-base-2M',
    revision: '389b9f64be5aa4ae7a6bc6fe95ef20ce485ae5da',
    onnx: 'onnx/model.onnx',
    files: [
      'onnx/model.onnx', 'tokenizer.json', 'tokenizer_config.json',
      'config.json', 'special_tokens_map.json', 'vocab.txt', 'modules.json',
    ],
  },
  {
    id: 'minishlab/potion-base-8M',
    dir: 'potion-base-8M',
    revision: 'bf8b056651a2c21b8d2565580b8569da283cab23',
    onnx: 'onnx/model.onnx',
    files: [
      'onnx/model.onnx', 'tokenizer.json', 'tokenizer_config.json',
      'config.json', 'special_tokens_map.json', 'vocab.txt', 'modules.json',
    ],
  },
  {
    id: 'TaylorAI/bge-micro-v2',
    dir: 'bge-micro-v2',
    revision: '3edf6d7de0faa426b09780416fe61009f26ae589',
    onnx: 'onnx/model_quantized.onnx',
    files: [
      'onnx/model_quantized.onnx', 'tokenizer.json', 'tokenizer_config.json',
      'config.json', 'special_tokens_map.json', 'vocab.txt', 'added_tokens.json',
      'modules.json', '1_Pooling/config.json',
    ],
  },
  {
    id: 'sentence-transformers/all-MiniLM-L6-v2',
    dir: 'all-MiniLM-L6-v2',
    revision: '1110a243fdf4706b3f48f1d95db1a4f5529b4d41',
    onnx: 'onnx/model_qint8_arm64.onnx',
    files: [
      'onnx/model_qint8_arm64.onnx', 'tokenizer.json', 'tokenizer_config.json',
      'config.json', 'special_tokens_map.json', 'vocab.txt', 'modules.json',
      '1_Pooling/config.json', 'sentence_bert_config.json',
      'config_sentence_transformers.json',
    ],
  },
  {
    id: 'cross-encoder/nli-deberta-v3-xsmall',
    dir: 'nli-deberta-v3-xsmall',
    revision: 'a150876415327c80daeff35ca6f68f5ed8cf5c24',
    onnx: 'onnx/model_qint8_arm64.onnx',
    files: [
      'onnx/model_qint8_arm64.onnx', 'tokenizer.json', 'tokenizer_config.json',
      'config.json', 'special_tokens_map.json', 'added_tokens.json', 'spm.model',
    ],
  },
];

// UT1 categories actually consumed. Keep this list small and justified: the
// `adult` archive alone is ~4.6M domains, and every extra category is more
// compile time and a larger shipped artifact for no measurement gain on a
// 208-row fixture. Selection covers exactly the taxonomy labels UT1 can speak to
// at a size that stays tractable inside the container.
//
// `adult` and `gambling` are included DESPITE the fixture having zero gold rows
// for them, because their false-positive behaviour on 208 gold-negative rows is
// measurable and is the single most forensically sensitive number this bench can
// produce.
const UT1_CATEGORIES = [
  'webmail', 'chat',
  'social_networks', 'forums', 'blog', 'dating',
  'press',
  'cooking', 'translation', 'sexual_education',
  'audio-video', 'radio', 'manga', 'celebrity', 'sports', 'educational_games',
  'ai', 'download', 'update', 'cleaning', 'webhosting', 'mobile-phone',
  'shopping', 'lingerie', 'marketingware',
  'bank', 'financial',
  'bitcoin',
  'jobsearch',
  'adult', 'mixed_adult',
  'gambling', 'arjel',
  'filehosting',
  'vpn', 'doh', 'dynamic-dns', 'residential-proxies', 'remote-control',
  'hacking', 'dangerous_material',
  'publicite', 'shortener',
];

const UT1_BASE = 'https://dsi.ut-capitole.fr/blacklists/download';

module.exports = { MODELS, UT1_CATEGORIES, UT1_BASE };
