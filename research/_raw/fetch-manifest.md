# Fetch manifest — issue #136 enumeration

All fetches performed by the parent agent (the researcher child has no network tool).
Generated 2026-08-08T09:46:16.976654+00:00

Every URL below was retrieved with `curl -sSL`. HTTP status recorded where captured.
A 404 means the URL in the research plan does not exist as written — treat the claim it was meant to support as STILL-UNKNOWN unless another row covers it.

## Sweep A — HF pipeline x onnx (top 100 by downloads, full=true)

- `zero-shot-classification` -> `hf-zero-shot-classification-onnx.json`, projected to `proj/hf-zero-shot-classification-onnx-part{1..4}.json`
  - https://huggingface.co/api/models?filter=zero-shot-classification,onnx&sort=downloads&direction=-1&limit=100&full=true
- `text-classification` -> `hf-text-classification-onnx.json`, projected to `proj/hf-text-classification-onnx-part{1..4}.json`
  - https://huggingface.co/api/models?filter=text-classification,onnx&sort=downloads&direction=-1&limit=100&full=true
- `feature-extraction` -> `hf-feature-extraction-onnx.json`, projected to `proj/hf-feature-extraction-onnx-part{1..4}.json`
  - https://huggingface.co/api/models?filter=feature-extraction,onnx&sort=downloads&direction=-1&limit=100&full=true

## Sweep B — families the pipeline taxonomy misses

- `sentence-similarity-onnx` — 100 models -> `proj/sweep-sentence-similarity-onnx-part*.json`
  - https://huggingface.co/api/models?filter=sentence-similarity,onnx&sort=downloads&direction=-1&limit=100&full=true
- `model2vec-filter` — 100 models -> `proj/sweep-model2vec-filter-part*.json`
  - https://huggingface.co/api/models?filter=model2vec&sort=downloads&direction=-1&limit=100&full=true
- `model2vec-library` — 100 models -> `proj/sweep-model2vec-library-part*.json`
  - https://huggingface.co/api/models?library=model2vec&sort=downloads&direction=-1&limit=100&full=true
- `setfit` — 100 models -> `proj/sweep-setfit-part*.json`
  - https://huggingface.co/api/models?filter=setfit&sort=downloads&direction=-1&limit=100&full=true
- `search-fasttext` — 50 models -> `proj/sweep-search-fasttext-part*.json`
  - https://huggingface.co/api/models?search=fasttext&sort=downloads&direction=-1&limit=50&full=true
- `search-url-classification` — 8 models -> `proj/sweep-search-url-classification-part*.json`
  - https://huggingface.co/api/models?search=url%20classification&sort=downloads&direction=-1&limit=50&full=true
- `search-website-category` — 2 models -> `proj/sweep-search-website-category-part*.json`
  - https://huggingface.co/api/models?search=website%20category&sort=downloads&direction=-1&limit=50&full=true
- `author-onnx-community` — 100 models -> `proj/sweep-author-onnx-community-part*.json`
  - https://huggingface.co/api/models?author=onnx-community&sort=downloads&direction=-1&limit=100&full=true
- `author-Xenova` — 100 models -> `proj/sweep-author-Xenova-part*.json`
  - https://huggingface.co/api/models?author=Xenova&sort=downloads&direction=-1&limit=100&full=true

## Per-model verification (54 models)

IDs in `tree-fetch-ids.json`. For each `<id>` (slug = id with `/`->`__`):

- `https://huggingface.co/api/models/<id>/tree/main?recursive=true` -> `trees/<slug>.json` (REAL byte sizes, field `size`)
- `https://huggingface.co/<id>/raw/main/README.md` and `/LICENSE*` -> `licences/<slug>.md`
- `https://huggingface.co/<id>/raw/main/config.json` -> `configs/<slug>.json` (`id2label` for fixed-label-set finding)

Per-URL status: `fetch-manifest-trees.tsv`, `fetch-manifest-licences.tsv`, `fetch-manifest-configs.tsv`

## External / literature / runtime

- `ext/mteb-space-info.json` — HTTP 200, 28030B
  - https://huggingface.co/api/spaces/mteb/leaderboard
- `ext/mteb-models-overview.py` — HTTP 404, 14B **<- 404, NOT AVAILABLE**
  - https://raw.githubusercontent.com/embeddings-benchmark/mteb/main/mteb/models/overview.py
- `ext/homepage2vec-README.md` — HTTP 200, 6484B
  - https://raw.githubusercontent.com/epfl-dlab/homepage2vec/master/README.md
- `ext/homepage2vec-LICENSE` — HTTP 200, 1073B
  - https://raw.githubusercontent.com/epfl-dlab/homepage2vec/master/LICENSE
- `ext/weborganizer-github-README.md` — HTTP 200, 7481B
  - https://raw.githubusercontent.com/CodeCreator/WebOrganizer/main/README.md
- `ext/weborganizer-hf-models.json` — HTTP 200, 716861B
  - https://huggingface.co/api/models?author=WebOrganizer&full=true
- `ext/fasttext-LICENSE` — HTTP 200, 1080B
  - https://raw.githubusercontent.com/facebookresearch/fastText/main/LICENSE
- `ext/model2vec-README.md` — HTTP 200, 13035B
  - https://raw.githubusercontent.com/MinishLab/model2vec/main/README.md
- `ext/model2vec-LICENSE` — HTTP 200, 1074B
  - https://raw.githubusercontent.com/MinishLab/model2vec/main/LICENSE
- `ext/setfit-LICENSE` — HTTP 200, 11357B
  - https://raw.githubusercontent.com/huggingface/setfit/main/LICENSE
- `ext/onnxruntime-LICENSE` — HTTP 200, 1073B
  - https://raw.githubusercontent.com/microsoft/onnxruntime/main/LICENSE
- `ext/transformersjs-LICENSE` — HTTP 200, 11358B
  - https://raw.githubusercontent.com/huggingface/transformers.js/main/LICENSE
- `ext/citizenlab-test-lists-LICENSE` — HTTP 404, 14B **<- 404, NOT AVAILABLE**
  - https://raw.githubusercontent.com/citizenlab/test-lists/master/LICENSE
- `ext/tldts-LICENSE` — HTTP 200, 1078B
  - https://raw.githubusercontent.com/remusao/tldts/master/LICENSE
- `ext/arxiv-webpage-classification.xml` — HTTP 200, 3615B
  - https://export.arxiv.org/api/query?search_query=all:%22webpage%20classification%22+AND+all:%22URL%22&sortBy=submittedDate&sortOrder=descending&max_results=50
- `ext/arxiv-short-text-classification.xml` — HTTP 200, 75024B
  - https://export.arxiv.org/api/query?search_query=all:%22short%20text%20classification%22&sortBy=submittedDate&sortOrder=descending&max_results=50
- `ext/mteb-model_meta.py` — HTTP 200, 70995B
  - https://raw.githubusercontent.com/embeddings-benchmark/mteb/main/mteb/models/model_meta.py
- `ext/mteb-get_model_meta.py` — HTTP 200, 8859B
  - https://raw.githubusercontent.com/embeddings-benchmark/mteb/main/mteb/models/get_model_meta.py
- `ext/mteb-model_implementations-listing.json` — HTTP 200, 247987B
  - https://api.github.com/repos/embeddings-benchmark/mteb/contents/mteb/models/model_implementations
- `ext/mteb-repo-LICENSE` — HTTP 200, 11357B
  - https://raw.githubusercontent.com/embeddings-benchmark/mteb/main/LICENSE
- `ext/citizenlab-README.md` — HTTP 200, 3227B
  - https://raw.githubusercontent.com/citizenlab/test-lists/master/README.md
- `ext/ut1-blacklists-index_en.html` — HTTP 200, 23312B
  - https://dsi.ut-capitole.fr/blacklists/index_en.php
- `ext/tranco-faq.html` — HTTP 404, 14B **<- 404, NOT AVAILABLE**
  - https://tranco-list.eu/faq
- `ext/tranco-home.html` — HTTP 200, 25636B
  - https://tranco-list.eu/
- `ext/publicsuffix-home.html` — HTTP 200, 3018B
  - https://publicsuffix.org/
