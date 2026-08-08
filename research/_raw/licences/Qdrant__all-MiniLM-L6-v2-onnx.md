# Authoritative licence sources for Qdrant/all-MiniLM-L6-v2-onnx


## README.md
Source: https://huggingface.co/Qdrant/all-MiniLM-L6-v2-onnx/raw/main/README.md

```
---
license: apache-2.0
pipeline_tag: sentence-similarity
---

ONNX port of [sentence-transformers/all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) for text classification and similarity searches.

### Usage

Here's an example of performing inference using the model with [FastEmbed](https://github.com/qdrant/fastembed).

```py
from fastembed import TextEmbedding

documents = [
    "You should stay, study and sprint.",
    "History can only prepare us to be surprised yet again.",
]

model = TextEmbedding(model_name="sentence-transformers/all-MiniLM-L6-v2")
embeddings = list(model.embed(documents))

# [
#     array([
#         0.00611658, 0.00068912, -0.0203846, ..., -0.01751488, -0.01174267,
#         0.01463472
#     ],
#           dtype=float32),
#     array([
#         0.00173448, -0.00329958, 0.01557874, ..., -0.01473586, 0.0281806,
#         -0.00448205
#     ],
#           dtype=float32)
# ]
```
```
