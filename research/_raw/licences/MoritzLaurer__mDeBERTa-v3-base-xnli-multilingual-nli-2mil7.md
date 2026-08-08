# Authoritative licence sources for MoritzLaurer/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7


## README.md
Source: https://huggingface.co/MoritzLaurer/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7/raw/main/README.md

```
---
language:
- multilingual
- zh
- ja
- ar
- ko
- de
- fr
- es
- pt
- hi
- id
- it
- tr
- ru
- bn
- ur
- mr
- ta
- vi
- fa
- pl
- uk
- nl
- sv
- he
- sw
- ps
license: mit
tags:
- zero-shot-classification
- text-classification
- nli
- pytorch
datasets:
- MoritzLaurer/multilingual-NLI-26lang-2mil7
- xnli
- multi_nli
- facebook/anli
- fever
- lingnli
- alisawuffles/WANLI
metrics:
- accuracy
pipeline_tag: zero-shot-classification
widget:
- text: Angela Merkel ist eine Politikerin in Deutschland und Vorsitzende der CDU
  candidate_labels: politics, economy, entertainment, environment
model-index:
- name: DeBERTa-v3-base-xnli-multilingual-nli-2mil7
  results:
  - task:
      type: text-classification
      name: Natural Language Inference
    dataset:
      name: MultiNLI-matched
      type: multi_nli
      split: validation_matched
    metrics:
    - type: accuracy
      value: 0,857
      verified: false
  - task:
      type: text-classification
      name: Natural Language Inference
    dataset:
      name: MultiNLI-mismatched
      type: multi_nli
      split: validation_mismatched
    metrics:
    - type: accuracy
      value: 0,856
      verified: false
  - task:
      type: text-classification
      name: Natural Language Inference
    dataset:
      name: ANLI-all
      type: anli
      split: test_r1+test_r2+test_r3
    metrics:
    - type: accuracy
      value: 0,537
      verified: false
  - task:
      type: text-classification
      name: Natural Language Inference
    dataset:
      name: ANLI-r3
      type: anli
      split: test_r3
    metrics:
    - type: accuracy
      value: 0,497
      verified: false
  - task:
      type: text-classification
      name: Natural Language Inference
    dataset:
      name: WANLI
      type: alisawuffles/WANLI
      split: test
    metrics:
    - type: accuracy
      value: 0,732
      verified: false
  - task:
      type: text-classification
      name: Natural Language Inference
    dataset:
      name: LingNLI
      type: lingnli
      split: test
    metrics:
    - type: accuracy
      value: 0,788
      verified: false
  - task:
      type: text-classification
      name: Natural Language Inference
    dataset:
      name: fever-nli
      type: fever-nli
      split: test
    metrics:
    - type: accuracy
      value: 0,761
      verified: false
---
# Model card for mDeBERTa-v3-base-xnli-multilingual-nli-2mil7

## Model description

This multilingual model can perform natural language inference (NLI) on 100 languages and is therefore also suitable for multilingual zero-shot classification. The underlying mDeBERTa-v3-base model was pre-trained by Microsoft on the [CC100 multilingual dataset](https://huggingface.co/datasets/cc100) with 100 languages. The model was then fine-tuned on the [XNLI dataset](https://huggingface.co/datasets/xnli) and on the [multilingual-NLI-26lang-2mil7 dataset](https://huggingface.co/datasets/MoritzLaurer/multilingual-NLI-26lang-2mil7). Both datasets contain more than 2.7 million hypothesis-premise pairs in 27 languages spoken by more than 4 billion people. 

As of December 2021, mDeBERTa-v3-base is the best performing multilingual base-sized transformer model introduced by Microsoft in [this paper](https://arxiv.org/pdf/2111.09543.pdf). 


### How to use the model
#### Simple zero-shot classification pipeline
```python
from transformers import pipeline
classifier = pipeline("zero-shot-classification", model="MoritzLaurer/mDeBERTa-v3-base-mnli-xnli")
sequence_to_classify = "Angela Merkel ist eine Politikerin in Deutschland und Vorsitzende der CDU"
candidate_labels = ["politics", "economy", "entertainment", "environment"]
output = classifier(sequence_to_classify, candidate_labels, multi_label=False)
print(output)
```
#### NLI use-case
```python
from transformers import AutoTokenizer, AutoModelForSequenceClassification
import torch
device = torch.device("cuda") if torch.cuda.is_available() else torch.device("cpu")

model_name = "MoritzLaurer/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7"
tokenizer = AutoTokenizer.from_pretrained(model_name)
model = AutoModelForSequenceClassification.from_pretrained(model_name)

premise = "Angela Merkel ist eine Politikerin in Deutschland und Vorsitzende der CDU"
hypothesis = "Emmanuel Macron is the President of France"

input = tokenizer(premise, hypothesis, truncation=True, return_tensors="pt")
output = model(input["input_ids"].to(device))  # device = "cuda:0" or "cpu"
prediction = torch.softmax(output["logits"][0], -1).tolist()
label_names = ["entailment", "neutral", "contradiction"]
prediction = {name: round(float(pred) * 100, 1) for pred, name in zip(prediction, label_names)}
print(prediction)
```

### Training data
This model was trained on the [multilingual-nli-26lang-2mil7 dataset](https://huggingface.co/datasets/MoritzLaurer/multilingual-NLI-26lang-2mil7) and the [XNLI](https://huggingface.co/datasets/xnli) validation dataset. 

The multilingual-nli-26lang-2mil7 dataset contains 2 730 000 NLI hypothesis-premise pairs in 26 languages spoken by more than 4 billion people. The dataset contains 105 000 text pairs per language. It is based on the English datasets [MultiNLI](https://huggingface.co/datasets/multi_nli), [Fever-NLI](https://github.com/easonnie/combine-FEVER-NSMN/blob/master/other_resources/nli_fever.md), [ANLI](https://huggingface.co/datasets/anli), [LingNLI](https://arxiv.org/pdf/2104.07179.pdf) and [WANLI](https://huggingface.co/datasets/alisawuffles/WANLI) and was created using the latest open-source machine translation models. The languages in the dataset are: ['ar', 'bn', 'de', 'es', 'fa', 'fr', 'he', 'hi', 'id', 'it', 'ja', 'ko', 'mr', 'nl', 'pl', 'ps', 'pt', 'ru', 'sv', 'sw', 'ta', 'tr', 'uk', 'ur', 'vi', 'zh'] (see [ISO language codes](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes). For more details, see the [datasheet](XXX). In addition, a sample of 105 000 text pairs was also added for English following the same sampling method as the other langua
```

## LICENSE
Source: https://huggingface.co/MoritzLaurer/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7/raw/main/LICENSE

```
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED *AS IS*, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
