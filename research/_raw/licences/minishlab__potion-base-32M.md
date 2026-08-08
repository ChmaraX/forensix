# Authoritative licence sources for minishlab/potion-base-32M

## README.md
Source: https://huggingface.co/minishlab/potion-base-32M/raw/main/README.md
HTTP 200, 5324 chars (FULL, untruncated)

```
---
datasets:
- minishlab/tokenlearn-c4-en-bge-base-v1.5
library_name: model2vec
license: mit
model_name: potion-base-32M
tags:
- embeddings
- static-embeddings
- mteb
- sentence-transformers
---


# potion-base-32M Model Card

<div align="center">
  <img width="35%" alt="Model2Vec logo" src="https://raw.githubusercontent.com/MinishLab/model2vec/main/assets/images/logo_v2.png">
</div>


This [Model2Vec](https://github.com/MinishLab/model2vec) model is pre-trained using [Tokenlearn](https://github.com/MinishLab/tokenlearn). It is a distilled version of the [baai/bge-base-en-v1.5](https://huggingface.co/baai/bge-base-en-v1.5) Sentence Transformer. It uses static embeddings, allowing text embeddings to be computed orders of magnitude faster on both GPU and CPU. It is designed for applications where computational resources are limited or where real-time performance is critical. It uses a larger vocabulary size than the [potion-base-8M](https://huggingface.co/minishlab/potion-base-8M) model which can be beneficial for tasks that require a larger vocabulary.



## Installation

Install model2vec using pip:
```
pip install model2vec
```

## Usage
Load this model using the `from_pretrained` method:
```python
from model2vec import StaticModel

# Load a pretrained Model2Vec model
model = StaticModel.from_pretrained("minishlab/potion-base-32M")

# Compute text embeddings
embeddings = model.encode(["Example sentence"])
```


## How it works

Model2vec creates a small, static model that outperforms other static embedding models by a large margin on all tasks on [MTEB](https://huggingface.co/spaces/mteb/leaderboard). This model is pre-trained using [Tokenlearn](https://github.com/MinishLab/tokenlearn). It's created using the following steps:
- Distillation: first, a model is distilled from a sentence transformer model using Model2Vec.
- Training data creation: the sentence transformer model is used to create training data by creating mean output embeddings on a large corpus.
- Training: the distilled model is trained on the training data using Tokenlearn.
- Post-training re-regularization: after training, the model is re-regularized by weighting the tokens based on their frequency, applying PCA, and finally applying [SIF weighting](https://openreview.net/pdf?id=SyK00v5xx).





## Results

| Model | Avg (All) | Avg (MTEB) | Class | Clust | PairClass | Rank | Ret | STS | Sum | Pearl | WordSim |
|:---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| [all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) | 55.80 | 55.93 | 69.25 | 44.90 | 82.37 | 47.14 | 42.92 | 78.95 | 25.96 | 60.83 | 49.91 |
| **[potion-base-32M](https://huggingface.co/minishlab/potion-base-32M)** | **52.83** | **52.13** | **71.70** | **41.25** | **78.17** | **42.45** | **32.67** | **73.93** | **24.74** | **55.37** | **55.15** |
| [potion-base-8M](https://huggingface.co/minishlab/potion-base-8M) | 51.32 | 51.08 | 70.34 | 39.74 | 76.62 | 41.79 | 31.11 | 72.91 | 25.06 | 53.54 | 50.75 |
| [potion-base-4M](https://huggingface.co/minishlab/potion-base-4M) | 50.01 | 49.77 | 68.00 | 39.47 | 75.37 | 41.41 | 28.43 | 71.87 | 23.82 | 52.55 | 49.21 |
| [M2V_base_output](https://huggingface.co/minishlab/M2V_base_output) | 48.77 | 47.96 | 66.84 | 33.96 | 74.90 | 39.31 | 25.36 | 68.76 | 26.61 | 54.02 | 49.18 |
| [potion-base-2M](https://huggingface.co/minishlab/potion-base-2M) | 47.55 | 47.49 | 64.13 | 37.53 | 73.72 | 40.46 | 22.99 | 69.77 | 23.80 | 50.82 | 44.72 |
| [GloVe_300d](https://huggingface.co/sentence-transformers/average_word_embeddings_glove.6B.300d) | 45.49 | 45.82 | 62.73 | 37.10 | 72.48 | 38.28 | 21.80 | 61.52 | 26.81 | 45.65 | 43.05 |
| [BPEmb_50k_300d](https://github.com/bheinzerling/bpemb) | 42.33 | 41.74 | 61.72 | 35.17 | 57.86 | 37.26 | 15.36 | 55.30 | 29.49 | 47.56 | 41.28 |

The results show that **potion-base-32M** is the most performant static embedding model, reaching 94.66% of the performance of [all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) with an average score of 52.83 while being orders of magnitude faster.

For full results, see the [MTEB leaderboard](https://huggingface.co/spaces/mteb/leaderboard).

## Additional Resources

- [All Model2Vec models on the hub](https://huggingface.co/models?library=model2vec)
- [Model2Vec Repo](https://github.com/MinishLab/model2vec)
- [Tokenlearn repo](https://github.com/MinishLab/tokenlearn)
- [Model2Vec Results](https://github.com/MinishLab/model2vec/blob/main/results/README.md)
- [Model2Vec Tutorials](https://github.com/MinishLab/model2vec/tree/main/tutorials)

## Library Authors

Model2Vec was developed by the [Minish Lab](https://github.com/MinishLab) team consisting of [Stephan Tulkens](https://github.com/stephantul) and [Thomas van Dongen](https://github.com/Pringled).

## Citation

Please cite the [Model2Vec repository](https://github.com/MinishLab/model2vec) if you use this model in your work.
```bibtex
@software{minishlab2024model2vec,
  author       = {Stephan Tulkens and {van Dongen}, Thomas},
  title        = {Model2Vec: Fast State-of-the-Art Static Embeddings},
  year         = {2024},
  publisher    = {Zenodo},
  doi          = {10.5281/zenodo.17270888},
  url          = {https://github.com/MinishLab/model2vec},
  license      = {MIT}
}
```
```

## LICENSE
Source: https://huggingface.co/minishlab/potion-base-32M/raw/main/LICENSE
HTTP 404 — NOT PRESENT

## LICENSE.txt
Source: https://huggingface.co/minishlab/potion-base-32M/raw/main/LICENSE.txt
HTTP 404 — NOT PRESENT

## LICENSE.md
Source: https://huggingface.co/minishlab/potion-base-32M/raw/main/LICENSE.md
HTTP 404 — NOT PRESENT

## NOTICE
Source: https://huggingface.co/minishlab/potion-base-32M/raw/main/NOTICE
HTTP 404 — NOT PRESENT
