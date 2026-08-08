# Authoritative licence sources for Alibaba-NLP/gte-reranker-modernbert-base


## README.md
Source: https://huggingface.co/Alibaba-NLP/gte-reranker-modernbert-base/raw/main/README.md

```
---
license: apache-2.0
language:
- en
base_model:
- answerdotai/ModernBERT-base
base_model_relation: finetune
pipeline_tag: text-ranking
library_name: transformers
tags:
- sentence-transformers
- transformers.js
- text-embeddings-inference
---

# gte-reranker-modernbert-base

We are excited to introduce the `gte-modernbert` series of models, which are built upon the latest modernBERT pre-trained encoder-only foundation models. The `gte-modernbert` series models include both text embedding models and rerank models.

The `gte-modernbert` models demonstrates competitive performance in several text embedding and text retrieval evaluation tasks when compared to similar-scale models from the current open-source community. This includes assessments such as **MTEB**, **LoCO**, and **COIR** evaluation.

## Model Overview

- Developed by: Tongyi Lab, Alibaba Group
- Model Type: Text reranker	
- Primary Language: English
- Model Size: 149M
- Max Input Length: 8192 tokens

### Model list


|                                         Models                                         | Language |       Model Type       | Model Size | Max Seq. Length | Dimension | MTEB-en | BEIR | LoCo | CoIR |
|:--------------------------------------------------------------------------------------:|:--------:|:----------------------:|:----------:|:---------------:|:---------:|:-------:|:----:|:----:|:----:|
|  [`gte-modernbert-base`](https://huggingface.co/Alibaba-NLP/gte-modernbert-base)   | English  |     text embedding     |    149M    |      8192       |    768    |  64.38  | 55.33 | 87.57 | 79.31 | 
| [`gte-reranker-modernbert-base`](https://huggingface.co/Alibaba-NLP/gte-reranker-modernbert-base)  | English  | text reranker     |    149M    |    8192    |     -     |  - | 56.19 | 90.68 | 79.99 |

## Usage

> [!TIP]
> For `transformers` and `sentence-transformers`, if your GPU supports it, the efficient Flash Attention 2 will be used automatically if you have `flash_attn` installed. It is not mandatory.
> 
> ```bash
> pip install flash_attn
> ```

Use with `transformers`
```python
# Requires transformers>=4.48.0
import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

model_name_or_path = "Alibaba-NLP/gte-reranker-modernbert-base"
tokenizer = AutoTokenizer.from_pretrained(model_name_or_path)
model = AutoModelForSequenceClassification.from_pretrained(
    model_name_or_path,
    torch_dtype=torch.float16,
)
model.eval()

pairs = [
    ["what is the capital of China?", "Beijing"],
    ["how to implement quick sort in python?", "Introduction of quick sort"],
    ["how to implement quick sort in python?", "The weather is nice today"],
]

with torch.no_grad():
    inputs = tokenizer(pairs, padding=True, truncation=True, return_tensors='pt', max_length=512)
    scores = model(**inputs, return_dict=True).logits.view(-1, ).float()
    print(scores)

# tensor([ 2.1387,  2.4609, -1.6729])
```
Use with `sentence-transformers`:

Before you start, install the sentence-transformers libraries:
```
pip install sentence-transformers
```

```python
# Requires transformers>=4.48.0
from sentence_transformers import CrossEncoder

model = CrossEncoder(
    "Alibaba-NLP/gte-reranker-modernbert-base",
    automodel_args={"torch_dtype": "auto"},
)

pairs = [
    ["what is the capital of China?", "Beijing"],
    ["how to implement quick sort in python?","Introduction of quick sort"],
    ["how to implement quick sort in python?", "The weather is nice today"],
]

scores = model.predict(pairs)
print(scores)
# [0.8945664  0.9213594  0.15742092]
# NOTE: Sentence Transformers calls Softmax over the outputs by default, hence the scores are in [0, 1] range.
```

Use with `transformers.js`
```js
import {
  AutoTokenizer,
  AutoModelForSequenceClassification,
} from "@huggingface/transformers";

const model_id = "Alibaba-NLP/gte-reranker-modernbert-base";
const model = await AutoModelForSequenceClassification.from_pretrained(
  model_id,
  { dtype: "fp32" }, // Supported options: "fp32", "fp16", "q8", "q4", "q4f16"
);
const tokenizer = await AutoTokenizer.from_pretrained(model_id);

const pairs = [
  ["what is the capital of China?", "Beijing"],
  ["how to implement quick sort in python?", "Introduction of quick sort"],
  ["how to implement quick sort in python?", "The weather is nice today"],
];
const inputs = tokenizer(
  pairs.map((x) => x[0]),
  {
    text_pair: pairs.map((x) => x[1]),
    padding: true,
    truncation: true,
  },
);
const { logits } = await model(inputs);
console.log(logits.tolist()); // [[2.138258218765259], [2.4609625339508057], [-1.6775450706481934]]
```

Additionally, you can also deploy `Alibaba-NLP/gte-reranker-modernbert-base` with [Text Embeddings Inference (TEI)](https://github.com/huggingface/text-embeddings-inference) as follows:

- CPU

```bash
docker run --platform linux/amd64 \
  -p 8080:80 \
  -v $PWD/data:/data \
  --pull always \
  ghcr.io/huggingface/text-embeddings-inference:cpu-1.7 \
  --model-id Alibaba-NLP/gte-reranker-modernbert-base
```

- GPU

```bash
docker run --gpus all \
  -p 8080:80 \
  -v $PWD/data:/data \
  --pull always \
  ghcr.io/huggingface/text-embeddings-inference:1.7 \
  --model-id Alibaba-NLP/gte-reranker-modernbert-base
```

Then you can send requests to the deployed API via the `/rerank` route (see the [Text Embeddings Inference OpenAPI Specification](https://huggingface.github.io/text-embeddings-inference/) for more details):

```bash
curl https://0.0.0.0:8080/rerank \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What is the capital of China?",
    "raw_scores": false,
    "return_text": false,
    "texts": [ "Beijing" ],
    "truncate": true,
    "truncation_direction": "right"
  }'
```

## Training Details

The `gte-modernbert` series of models follows the training scheme of the previous [GTE models](https://huggingface.co/collections/Alibaba-NLP/gte-models-6680f0b13f885cb431e6d469), with the only difference being that the pre-training l
```
