# Authoritative licence sources for MoritzLaurer/mDeBERTa-v3-base-mnli-xnli


## README.md
Source: https://huggingface.co/MoritzLaurer/mDeBERTa-v3-base-mnli-xnli/raw/main/README.md

```
---
language: 
- multilingual
- en 
- ar 
- bg 
- de 
- el 
- es 
- fr 
- hi 
- ru 
- sw 
- th 
- tr 
- ur 
- vi 
- zh
license: mit
tags:
- zero-shot-classification
- text-classification
- nli
- pytorch
metrics:
- accuracy
datasets:
- multi_nli
- xnli
pipeline_tag: zero-shot-classification
widget:
- text: "Angela Merkel ist eine Politikerin in Deutschland und Vorsitzende der CDU"
  candidate_labels: "politics, economy, entertainment, environment"
---
# Multilingual mDeBERTa-v3-base-mnli-xnli
## Model description
This multilingual model can perform natural language inference (NLI) on 100 languages and is therefore also suitable for multilingual 
zero-shot classification. The underlying model was pre-trained by Microsoft on the 
[CC100 multilingual dataset](https://huggingface.co/datasets/cc100). It was then fine-tuned on the [XNLI dataset](https://huggingface.co/datasets/xnli), which contains hypothesis-premise pairs from 15 languages, as well as the English [MNLI dataset](https://huggingface.co/datasets/multi_nli).
As of December 2021, mDeBERTa-base is the best performing multilingual base-sized transformer model, 
introduced by Microsoft in [this paper](https://arxiv.org/pdf/2111.09543.pdf). 

If you are looking for a smaller, faster (but less performant) model, you can 
try [multilingual-MiniLMv2-L6-mnli-xnli](https://huggingface.co/MoritzLaurer/multilingual-MiniLMv2-L6-mnli-xnli).

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

model_name = "MoritzLaurer/mDeBERTa-v3-base-mnli-xnli"
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
This model was trained on the XNLI development dataset and the MNLI train dataset. The XNLI development set consists of 2490 professionally translated texts from English to 14 other languages (37350 texts in total) (see [this paper](https://arxiv.org/pdf/1809.05053.pdf)). Note that the XNLI contains a training set of 15 machine translated versions of the MNLI dataset for 15 languages, but due to quality issues with these machine translations, this model was only trained on the professional translations from the XNLI development set and the original English MNLI training set (392 702 texts). Not using machine translated texts can avoid overfitting the model to the 15 languages; avoids catastrophic forgetting of the other 85 languages mDeBERTa was pre-trained on; and significantly reduces training costs. 

### Training procedure
mDeBERTa-v3-base-mnli-xnli was trained using the Hugging Face trainer with the following hyperparameters.
```
training_args = TrainingArguments(
    num_train_epochs=2,              # total number of training epochs
    learning_rate=2e-05,
    per_device_train_batch_size=16,   # batch size per device during training
    per_device_eval_batch_size=16,    # batch size for evaluation
    warmup_ratio=0.1,                # number of warmup steps for learning rate scheduler
    weight_decay=0.06,               # strength of weight decay
)
```
### Eval results
The model was evaluated on the XNLI test set on 15 languages (5010 texts per language, 75150 in total). Note that multilingual NLI models are capable of classifying NLI texts without receiving NLI training data in the specific language (cross-lingual transfer). This means that the model is also able of doing NLI on the other 85 languages mDeBERTa was training on, but performance is most likely lower than for those languages available in XNLI.

Also note that if other multilingual models on the model hub claim performance of around 90% on languages other than English, the authors have most likely made a mistake during testing since non of the latest papers shows a multilingual average performance of more than a few points above 80% on XNLI (see [here](https://arxiv.org/pdf/2111.09543.pdf) or [here](https://arxiv.org/pdf/1911.02116.pdf)). 

average | ar | bg | de | el | en | es | fr | hi | ru | sw | th | tr | ur | vi | zh 
---------|----------|---------|----------|----------|----------|----------|----------|----------|----------|----------|----------|----------|----------|----------|----------
0.808 | 0.802 | 0.829 | 0.825 | 0.826 | 0.883 | 0.845 | 0.834 | 0.771 | 0.813 | 0.748 | 0.793 | 0.807 | 0.740 | 0.795 | 0.8116

## Limitations and bias
Please consult the original DeBERTa-V3 paper and literature on different NLI datasets for potential biases. 

## Citation
If you use this model, please cite: Laurer, Moritz, Wouter van Atteveldt, Andreu Salleras Casas, and Kasper Welbers. 2022. ‘Less Annotating, More Classifying – Addressing the Data Scarcity Issue of Supervised Machine Learning with Deep Transfer Learning and BERT - NLI’. Preprint, June. Open Science Framework. https://osf.io/74b8k.

## Ideas for cooperation or questions?
If you have qu
```
