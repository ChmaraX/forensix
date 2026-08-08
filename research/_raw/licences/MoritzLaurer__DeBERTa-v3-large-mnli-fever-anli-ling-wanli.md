# Authoritative licence sources for MoritzLaurer/DeBERTa-v3-large-mnli-fever-anli-ling-wanli


## README.md
Source: https://huggingface.co/MoritzLaurer/DeBERTa-v3-large-mnli-fever-anli-ling-wanli/raw/main/README.md

```
---
language:
- en
license: mit
tags:
- text-classification
- zero-shot-classification
datasets:
- multi_nli
- facebook/anli
- fever
- lingnli
- alisawuffles/WANLI
metrics:
- accuracy
pipeline_tag: zero-shot-classification
model-index:
- name: DeBERTa-v3-large-mnli-fever-anli-ling-wanli
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
      value: 0,912
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
      value: 0,908
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
      value: 0,702
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
      value: 0,64
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
      value: 0,77
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
      value: 0,87
      verified: false
---

# DeBERTa-v3-large-mnli-fever-anli-ling-wanli
## Model description
This model was fine-tuned on the [MultiNLI](https://huggingface.co/datasets/multi_nli), [Fever-NLI](https://github.com/easonnie/combine-FEVER-NSMN/blob/master/other_resources/nli_fever.md), Adversarial-NLI ([ANLI](https://huggingface.co/datasets/anli)), [LingNLI](https://arxiv.org/pdf/2104.07179.pdf) and [WANLI](https://huggingface.co/datasets/alisawuffles/WANLI) datasets, which comprise 885 242 NLI hypothesis-premise pairs. This model is the best performing NLI model on the Hugging Face Hub as of 06.06.22 and can be used for zero-shot classification. It significantly outperforms all other large models on the [ANLI benchmark](https://github.com/facebookresearch/anli).

The foundation model is [DeBERTa-v3-large from Microsoft](https://huggingface.co/microsoft/deberta-v3-large). DeBERTa-v3 combines several recent innovations compared to classical Masked Language Models like BERT, RoBERTa etc., see the [paper](https://arxiv.org/abs/2111.09543)


### How to use the model
#### Simple zero-shot classification pipeline
```python
from transformers import pipeline
classifier = pipeline("zero-shot-classification", model="MoritzLaurer/DeBERTa-v3-large-mnli-fever-anli-ling-wanli")
sequence_to_classify = "Angela Merkel is a politician in Germany and leader of the CDU"
candidate_labels = ["politics", "economy", "entertainment", "environment"]
output = classifier(sequence_to_classify, candidate_labels, multi_label=False)
print(output)
```
#### NLI use-case
```python
from transformers import AutoTokenizer, AutoModelForSequenceClassification
import torch
device = torch.device("cuda") if torch.cuda.is_available() else torch.device("cpu")

model_name = "MoritzLaurer/DeBERTa-v3-large-mnli-fever-anli-ling-wanli"
tokenizer = AutoTokenizer.from_pretrained(model_name)
model = AutoModelForSequenceClassification.from_pretrained(model_name)

premise = "I first thought that I liked the movie, but upon second thought it was actually disappointing."
hypothesis = "The movie was not good."

input = tokenizer(premise, hypothesis, truncation=True, return_tensors="pt")
output = model(input["input_ids"].to(device))  # device = "cuda:0" or "cpu"
prediction = torch.softmax(output["logits"][0], -1).tolist()
label_names = ["entailment", "neutral", "contradiction"]
prediction = {name: round(float(pred) * 100, 1) for pred, name in zip(prediction, label_names)}
print(prediction)
```

### Training data
DeBERTa-v3-large-mnli-fever-anli-ling-wanli was trained on the [MultiNLI](https://huggingface.co/datasets/multi_nli), [Fever-NLI](https://github.com/easonnie/combine-FEVER-NSMN/blob/master/other_resources/nli_fever.md), Adversarial-NLI ([ANLI](https://huggingface.co/datasets/anli)), [LingNLI](https://arxiv.org/pdf/2104.07179.pdf) and [WANLI](https://huggingface.co/datasets/alisawuffles/WANLI) datasets, which comprise 885 242 NLI hypothesis-premise pairs. Note that [SNLI](https://huggingface.co/datasets/snli) was explicitly excluded due to quality issues with the dataset. More data does not necessarily make for better NLI models. 

### Training procedure
DeBERTa-v3-large-mnli-fever-anli-ling-wanli was trained using the Hugging Face trainer with the following hyperparameters. Note that longer training with more epochs hurt performance in my tests (overfitting).


```
training_args = TrainingArguments(
    num_train_epochs=4,              # total number of training epochs
    learning_rate=5e-06,
    per_device_train_batch_size=16,   # batch size per device during training
    gradient_accumulation_steps=2,    # doubles the effective batch_size to 32, while decreasing memory requirements
    per_device_eval_batch_size=64,    # batch size for evaluation
    warmup_ratio=0.06,                # number of warmup steps for learning rate scheduler
    weight_decay=0.01,               # strength of weight decay
    fp16=True                        # mixed precision training
)
```

### Eval results
The model was evaluated using the test sets for MultiNLI, ANLI, LingNLI, WANLI and the dev set for Fever-NLI. The metric used is accuracy.
The model achieves state-of-the-art performance on each dataset. Surprisingly, it outperforms the previous [state-of-the-art on ANLI](
```
