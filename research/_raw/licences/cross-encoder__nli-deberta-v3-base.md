# Authoritative licence sources for cross-encoder/nli-deberta-v3-base


## README.md
Source: https://huggingface.co/cross-encoder/nli-deberta-v3-base/raw/main/README.md

```
---
language: en
pipeline_tag: zero-shot-classification
tags:
- transformers
datasets:
- nyu-mll/multi_nli
- stanfordnlp/snli
metrics:
- accuracy
license: apache-2.0
base_model:
- microsoft/deberta-v3-base
library_name: sentence-transformers
---

# Cross-Encoder for Natural Language Inference
This model was trained using [SentenceTransformers](https://sbert.net) [Cross-Encoder](https://www.sbert.net/examples/applications/cross-encoder/README.html) class. This model is based on [microsoft/deberta-v3-base](https://huggingface.co/microsoft/deberta-v3-base)

## Training Data
The model was trained on the [SNLI](https://nlp.stanford.edu/projects/snli/) and [MultiNLI](https://cims.nyu.edu/~sbowman/multinli/) datasets. For a given sentence pair, it will output three scores corresponding to the labels: contradiction, entailment, neutral.

## Performance
- Accuracy on SNLI-test dataset: 92.38
- Accuracy on  MNLI mismatched set: 90.04

For futher evaluation results, see [SBERT.net - Pretrained Cross-Encoder](https://www.sbert.net/docs/pretrained_cross-encoders.html#nli).

## Usage

Pre-trained models can be used like this:
```python
from sentence_transformers import CrossEncoder
model = CrossEncoder('cross-encoder/nli-deberta-v3-base')
scores = model.predict([('A man is eating pizza', 'A man eats something'), ('A black race car starts up in front of a crowd of people.', 'A man is driving down a lonely road.')])

#Convert scores to labels
label_mapping = ['contradiction', 'entailment', 'neutral']
labels = [label_mapping[score_max] for score_max in scores.argmax(axis=1)]
```

## Usage with Transformers AutoModel
You can use the model also directly with Transformers library (without SentenceTransformers library):
```python
from transformers import AutoTokenizer, AutoModelForSequenceClassification
import torch

model = AutoModelForSequenceClassification.from_pretrained('cross-encoder/nli-deberta-v3-base')
tokenizer = AutoTokenizer.from_pretrained('cross-encoder/nli-deberta-v3-base')

features = tokenizer(['A man is eating pizza', 'A black race car starts up in front of a crowd of people.'], ['A man eats something', 'A man is driving down a lonely road.'],  padding=True, truncation=True, return_tensors="pt")

model.eval()
with torch.no_grad():
    scores = model(**features).logits
    label_mapping = ['contradiction', 'entailment', 'neutral']
    labels = [label_mapping[score_max] for score_max in scores.argmax(dim=1)]
    print(labels)
```

## Zero-Shot Classification
This model can also be used for zero-shot-classification:
```python
from transformers import pipeline

classifier = pipeline("zero-shot-classification", model='cross-encoder/nli-deberta-v3-base')

sent = "Apple just announced the newest iPhone X"
candidate_labels = ["technology", "sports", "politics"]
res = classifier(sent, candidate_labels)
print(res)
```
```
