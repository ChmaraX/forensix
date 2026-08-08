# Authoritative licence sources for knowledgator/gliclass-large-v1.0


## README.md
Source: https://huggingface.co/knowledgator/gliclass-large-v1.0/raw/main/README.md

```
---
license: apache-2.0
datasets:
- MoritzLaurer/synthetic_zeroshot_mixtral_v0.1
language:
- en
metrics:
- f1
pipeline_tag: zero-shot-classification
tags:
- text classification
- zero-shot
- small language models
- RAG
- sentiment analysis
---

# ⭐ GLiClass: Generalist and Lightweight Model for Sequence Classification

This is an efficient zero-shot classifier inspired by [GLiNER](https://github.com/urchade/GLiNER/tree/main) work. It demonstrates the same performance as a cross-encoder while being more compute-efficient because classification is done at a single forward path.

It can be used for `topic classification`, `sentiment analysis` and as a reranker in `RAG` pipelines.

The model was trained on synthetic data and can be used in commercial applications.

### How to use:
First of all, you need to install GLiClass library:
```bash
pip install gliclass
```

Than you need to initialize a model and a pipeline:
```python
from gliclass import GLiClassModel, ZeroShotClassificationPipeline
from transformers import AutoTokenizer

model = GLiClassModel.from_pretrained("knowledgator/gliclass-large-v1.0")
tokenizer = AutoTokenizer.from_pretrained("knowledgator/gliclass-large-v1.0")

pipeline = ZeroShotClassificationPipeline(model, tokenizer, classification_type='multi-label', device='cuda:0')

text = "One day I will see the world!"
labels = ["travel", "dreams", "sport", "science", "politics"]
results = pipeline(text, labels, threshold=0.5)[0] #because we have one text

for result in results:
 print(result["label"], "=>", result["score"])
```

### Benchmarks:
Below, you can see the F1 score on several text classification datasets. All tested models were not fine-tuned on those datasets and were tested in a zero-shot setting.
| Model                       | IMDB | AG_NEWS | Emotions |
|-----------------------------|------|---------|----------|
| [gliclass-large-v1.0 (438 M)](https://huggingface.co/knowledgator/gliclass-large-v1.0) | 0.9404 | 0.7516  | 0.4874  |
| [gliclass-base-v1.0 (186 M)](https://huggingface.co/knowledgator/gliclass-base-v1.0) | 0.8650 | 0.6837  | 0.4749  |
| [gliclass-small-v1.0 (144 M)](https://huggingface.co/knowledgator/gliclass-small-v1.0) | 0.8650 | 0.6805  | 0.4664   |
| [Bart-large-mnli (407 M)](https://huggingface.co/facebook/bart-large-mnli)      | 0.89 | 0.6887  | 0.3765   |
| [Deberta-base-v3 (184 M)](https://huggingface.co/cross-encoder/nli-deberta-v3-base)      | 0.85 | 0.6455  | 0.5095   |
| [Comprehendo (184M)](https://huggingface.co/knowledgator/comprehend_it-base)           | 0.90 | 0.7982  | 0.5660   |
| SetFit [BAAI/bge-small-en-v1.5 (33.4M)](https://huggingface.co/BAAI/bge-small-en-v1.5) | 0.86 | 0.5636 | 0.5754 |

Below you can find a comparison with other GLiClass models:
| Dataset              | gliclass-small-v1.0-lw | gliclass-base-v1.0-lw | gliclass-large-v1.0-lw | gliclass-small-v1.0 | gliclass-base-v1.0 | gliclass-large-v1.0 |
|----------------------|-----------------------|-----------------------|-----------------------|---------------------|---------------------|---------------------|
| CR                   | 0.8886                | 0.9097                | 0.9226                | 0.8824              | 0.8942              | 0.9219              |
| sst2                 | 0.8392                | 0.8987                | 0.9247                | 0.8518              | 0.8979              | 0.9269              |
| sst5                 | 0.2865                | 0.3779                | 0.2891                | 0.2424              | 0.2789              | 0.3900              |
| 20_news_groups       | 0.4572                | 0.3953                | 0.4083                | 0.3366              | 0.3576              | 0.3863              |
| spam                 | 0.5118                | 0.5126                | 0.3642                | 0.4089              | 0.4938              | 0.3661              |
| rotten_tomatoes      | 0.8015                | 0.8429                | 0.8807                | 0.7987              | 0.8508              | 0.8808              |
| massive              | 0.3180                | 0.4635                | 0.5606                | 0.2546              | 0.1893              | 0.4376              |
| banking              | 0.1768                | 0.4396                | 0.3317                | 0.1374              | 0.2077              | 0.2847              |
| yahoo_topics         | 0.4686                | 0.4784                | 0.4760                | 0.4477              | 0.4516              | 0.4921              |
| financial_phrasebank | 0.8665                | 0.8880                | 0.9044                | 0.8901              | 0.8955              | 0.8735              |
| imdb                 | 0.9048                | 0.9351                | 0.9429                | 0.8982              | 0.9238              | 0.9333              |
| ag_news              | 0.7252                | 0.6985                | 0.7559                | 0.7242              | 0.6848              | 0.7503              |
| dair_emotion         | 0.4012                | 0.3516                | 0.3951                | 0.3450              | 0.2357              | 0.4013              |
| capsotu              | 0.3794                | 0.4643                | 0.4749                | 0.3432              | 0.4375              | 0.4644              |
|Average:|0.5732|0.6183|0.6165|0.5401|0.5571|0.6078|

Here you can see how the performance of the model grows providing more examples:
| Model                       | Num Examples | sst5   | spam    | massive | banking | ag news | dair emotion | capsotu | Average     |
|-----------------------------|--------------|--------|---------|---------|---------|---------|--------------|---------|-------------|
| gliclass-small-v1.0-lw      | 0            | 0.2865 | 0.5118  | 0.318   | 0.1768  | 0.7252  | 0.4012       | 0.3794  | 0.3998428571|
| gliclass-base-v1.0-lw       | 0            | 0.3779 | 0.5126  | 0.4635  | 0.4396  | 0.6985  |
```
