# Authoritative licence sources for cross-encoder/mmarco-mMiniLMv2-L12-H384-v1


## README.md
Source: https://huggingface.co/cross-encoder/mmarco-mMiniLMv2-L12-H384-v1/raw/main/README.md

```
---
license: apache-2.0
language:
- en
- ar
- zh
- nl
- fr
- de
- hi
- in
- it
- ja
- pt
- ru
- es
- vi
- multilingual
datasets:
- unicamp-dl/mmarco
base_model:
- nreimers/mMiniLMv2-L12-H384-distilled-from-XLMR-Large
pipeline_tag: text-ranking
library_name: sentence-transformers
tags:
- transformers
---
# Cross-Encoder for multilingual MS Marco

This model was trained on the [MMARCO](https://hf.co/unicamp-dl/mmarco) dataset. It is a machine translated version of MS MARCO using Google Translate. It was translated to 14 languages. In our experiments, we observed that it performs also well for other languages.

As a base model, we used the [multilingual MiniLMv2](https://huggingface.co/nreimers/mMiniLMv2-L12-H384-distilled-from-XLMR-Large) model.

The model can be used for Information Retrieval: Given a query, encode the query will all possible passages (e.g. retrieved with ElasticSearch). Then sort the passages in a decreasing order. See [SBERT.net Retrieve & Re-rank](https://www.sbert.net/examples/applications/retrieve_rerank/README.html) for more details. The training code is available here: [SBERT.net Training MS Marco](https://github.com/UKPLab/sentence-transformers/tree/master/examples/training/ms_marco)

## Usage with SentenceTransformers

The usage becomes easy when you have [SentenceTransformers](https://www.sbert.net/) installed. Then, you can use the pre-trained models like this:
```python
from sentence_transformers import CrossEncoder
model = CrossEncoder('model_name')
scores = model.predict([('Query', 'Paragraph1'), ('Query', 'Paragraph2') , ('Query', 'Paragraph3')])
```




## Usage with Transformers

```python
from transformers import AutoTokenizer, AutoModelForSequenceClassification
import torch

model = AutoModelForSequenceClassification.from_pretrained('model_name')
tokenizer = AutoTokenizer.from_pretrained('model_name')

features = tokenizer(['How many people live in Berlin?', 'How many people live in Berlin?'], ['Berlin has a population of 3,520,031 registered inhabitants in an area of 891.82 square kilometers.', 'New York City is famous for the Metropolitan Museum of Art.'],  padding=True, truncation=True, return_tensors="pt")

model.eval()
with torch.no_grad():
    scores = model(**features).logits
    print(scores)
```
```
