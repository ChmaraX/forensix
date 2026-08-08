# Authoritative licence sources for sentence-transformers/paraphrase-multilingual-mpnet-base-v2


## README.md
Source: https://huggingface.co/sentence-transformers/paraphrase-multilingual-mpnet-base-v2/raw/main/README.md

```
---
language:
- multilingual
- ar
- bg
- ca
- cs
- da
- de
- el
- en
- es
- et
- fa
- fi
- fr
- gl
- gu
- he
- hi
- hr
- hu
- hy
- id
- it
- ja
- ka
- ko
- ku
- lt
- lv
- mk
- mn
- mr
- ms
- my
- nb
- nl
- pl
- pt
- ro
- ru
- sk
- sl
- sq
- sr
- sv
- th
- tr
- uk
- ur
- vi
license: apache-2.0
library_name: sentence-transformers
tags:
- sentence-transformers
- feature-extraction
- sentence-similarity
- transformers
- text-embeddings-inference
language_bcp47:
- fr-ca
- pt-br
- zh-cn
- zh-tw
pipeline_tag: sentence-similarity
---

# sentence-transformers/paraphrase-multilingual-mpnet-base-v2

This is a [sentence-transformers](https://www.SBERT.net) model: It maps sentences & paragraphs to a 768 dimensional dense vector space and can be used for tasks like clustering or semantic search.



## Usage (Sentence-Transformers)

Using this model becomes easy when you have [sentence-transformers](https://www.SBERT.net) installed:

```
pip install -U sentence-transformers
```

Then you can use the model like this:

```python
from sentence_transformers import SentenceTransformer
sentences = ["This is an example sentence", "Each sentence is converted"]

model = SentenceTransformer('sentence-transformers/paraphrase-multilingual-mpnet-base-v2')
embeddings = model.encode(sentences)
print(embeddings)
```



## Usage (HuggingFace Transformers)
Without [sentence-transformers](https://www.SBERT.net), you can use the model like this: First, you pass your input through the transformer model, then you have to apply the right pooling-operation on-top of the contextualized word embeddings.

```python
from transformers import AutoTokenizer, AutoModel
import torch


# Mean Pooling - Take attention mask into account for correct averaging
def mean_pooling(model_output, attention_mask):
    token_embeddings = model_output[0] # First element of model_output contains all token embeddings
    input_mask_expanded = attention_mask.unsqueeze(-1).expand(token_embeddings.size()).float()
    return torch.sum(token_embeddings * input_mask_expanded, 1) / torch.clamp(input_mask_expanded.sum(1), min=1e-9)


# Sentences we want sentence embeddings for
sentences = ['This is an example sentence', 'Each sentence is converted']

# Load model from HuggingFace Hub
tokenizer = AutoTokenizer.from_pretrained('sentence-transformers/paraphrase-multilingual-mpnet-base-v2')
model = AutoModel.from_pretrained('sentence-transformers/paraphrase-multilingual-mpnet-base-v2')

# Tokenize sentences
encoded_input = tokenizer(sentences, padding=True, truncation=True, return_tensors='pt')

# Compute token embeddings
with torch.no_grad():
    model_output = model(**encoded_input)

# Perform pooling. In this case, mean pooling
sentence_embeddings = mean_pooling(model_output, encoded_input['attention_mask'])

print("Sentence embeddings:")
print(sentence_embeddings)
```


## Usage (Text Embeddings Inference (TEI))

[Text Embeddings Inference (TEI)](https://github.com/huggingface/text-embeddings-inference) is a blazing fast inference solution for text embedding models.

- CPU:
```bash
docker run -p 8080:80 -v hf_cache:/data --pull always ghcr.io/huggingface/text-embeddings-inference:cpu-latest --model-id sentence-transformers/paraphrase-multilingual-mpnet-base-v2 --pooling mean --dtype float16
```

- NVIDIA GPU:
```bash
docker run --gpus all -p 8080:80 -v hf_cache:/data --pull always ghcr.io/huggingface/text-embeddings-inference:cuda-latest --model-id sentence-transformers/paraphrase-multilingual-mpnet-base-v2 --pooling mean --dtype float16
```

Send a request to `/v1/embeddings` to generate embeddings via the [OpenAI Embeddings API](https://platform.openai.com/docs/api-reference/embeddings/create):
```bash
curl http://localhost:8080/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{
    "model": "sentence-transformers/paraphrase-multilingual-mpnet-base-v2",
    "input": "This is an example sentence"
  }'
```

Or check the [Text Embeddings Inference API specification](https://huggingface.github.io/text-embeddings-inference/) instead.



## Full Model Architecture
```
SentenceTransformer(
  (0): Transformer({'max_seq_length': 128, 'do_lower_case': False}) with Transformer model: XLMRobertaModel 
  (1): Pooling({'word_embedding_dimension': 768, 'pooling_mode_cls_token': False, 'pooling_mode_mean_tokens': True, 'pooling_mode_max_tokens': False, 'pooling_mode_mean_sqrt_len_tokens': False})
)
```

## Citing & Authors

This model was trained by [sentence-transformers](https://www.sbert.net/). 
        
If you find this model helpful, feel free to cite our publication [Sentence-BERT: Sentence Embeddings using Siamese BERT-Networks](https://arxiv.org/abs/1908.10084):
```bibtex 
@inproceedings{reimers-2019-sentence-bert,
    title = "Sentence-BERT: Sentence Embeddings using Siamese BERT-Networks",
    author = "Reimers, Nils and Gurevych, Iryna",
    booktitle = "Proceedings of the 2019 Conference on Empirical Methods in Natural Language Processing",
    month = "11",
    year = "2019",
    publisher = "Association for Computational Linguistics",
    url = "http://arxiv.org/abs/1908.10084",
}
```
```
