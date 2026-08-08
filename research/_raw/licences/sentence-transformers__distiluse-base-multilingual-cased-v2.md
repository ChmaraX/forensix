# Authoritative licence sources for sentence-transformers/distiluse-base-multilingual-cased-v2


## README.md
Source: https://huggingface.co/sentence-transformers/distiluse-base-multilingual-cased-v2/raw/main/README.md

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
language_bcp47:
- fr-ca
- pt-br
- zh-cn
- zh-tw
pipeline_tag: sentence-similarity
---

# sentence-transformers/distiluse-base-multilingual-cased-v2

This is a [sentence-transformers](https://www.SBERT.net) model: It maps sentences & paragraphs to a 512 dimensional dense vector space and can be used for tasks like clustering or semantic search.



## Usage (Sentence-Transformers)

Using this model becomes easy when you have [sentence-transformers](https://www.SBERT.net) installed:

```
pip install -U sentence-transformers
```

Then you can use the model like this:

```python
from sentence_transformers import SentenceTransformer
sentences = ["This is an example sentence", "Each sentence is converted"]

model = SentenceTransformer('sentence-transformers/distiluse-base-multilingual-cased-v2')
embeddings = model.encode(sentences)
print(embeddings)
```



## Full Model Architecture
```
SentenceTransformer(
  (0): Transformer({'max_seq_length': 128, 'do_lower_case': False}) with Transformer model: DistilBertModel 
  (1): Pooling({'word_embedding_dimension': 768, 'pooling_mode_cls_token': False, 'pooling_mode_mean_tokens': True, 'pooling_mode_max_tokens': False, 'pooling_mode_mean_sqrt_len_tokens': False})
  (2): Dense({'in_features': 768, 'out_features': 512, 'bias': True, 'activation_function': 'torch.nn.modules.activation.Tanh'})
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
