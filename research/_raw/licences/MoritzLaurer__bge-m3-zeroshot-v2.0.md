# Authoritative licence sources for MoritzLaurer/bge-m3-zeroshot-v2.0


## README.md
Source: https://huggingface.co/MoritzLaurer/bge-m3-zeroshot-v2.0/raw/main/README.md

```
---
language:
- multilingual
tags:
- text-classification
- zero-shot-classification
base_model: BAAI/bge-m3-retromae
pipeline_tag: zero-shot-classification
library_name: transformers
license: mit
---

# Model description:  bge-m3-zeroshot-v2.0

## zeroshot-v2.0 series of models
Models in this series are designed for efficient zeroshot classification with the Hugging Face pipeline. 
These models can do classification without training data and run on both GPUs and CPUs. 
An overview of the latest zeroshot classifiers is available in my [Zeroshot Classifier Collection](https://huggingface.co/collections/MoritzLaurer/zeroshot-classifiers-6548b4ff407bb19ff5c3ad6f).

The main update of this `zeroshot-v2.0` series of models is that several models are trained on fully commercially-friendly data for users with strict license requirements.

These models can do one universal classification task: determine whether a hypothesis is "true" or "not true" given a text
(`entailment` vs. `not_entailment`).  
This task format is based on the Natural Language Inference task (NLI).
The task is so universal that any classification task can be reformulated into this task by the Hugging Face pipeline.


## Training data
Models with a "`-c`" in the name are trained on two types of fully commercially-friendly data: 
1. Synthetic data generated with [Mixtral-8x7B-Instruct-v0.1](https://huggingface.co/mistralai/Mixtral-8x7B-Instruct-v0.1).
I first created a list of 500+ diverse text classification tasks for 25 professions in conversations with Mistral-large. The data was manually curated.
I then used this as seed data to generate several hundred thousand texts for these tasks with Mixtral-8x7B-Instruct-v0.1.
The final dataset used is available in the [synthetic_zeroshot_mixtral_v0.1](https://huggingface.co/datasets/MoritzLaurer/synthetic_zeroshot_mixtral_v0.1) dataset
in the subset `mixtral_written_text_for_tasks_v4`. Data curation was done in multiple iterations and will be improved in future iterations. 
2. Two commercially-friendly NLI datasets: ([MNLI](https://huggingface.co/datasets/nyu-mll/multi_nli), [FEVER-NLI](https://huggingface.co/datasets/fever)).
These datasets were added to increase generalization.
3. Models without a "`-c`" in the name also included a broader mix of training data with a broader mix of licenses: ANLI, WANLI, LingNLI,
and all datasets in [this list](https://github.com/MoritzLaurer/zeroshot-classifier/blob/7f82e4ab88d7aa82a4776f161b368cc9fa778001/v1_human_data/datasets_overview.csv)
where `used_in_v1.1==True`.


## How to use the models
```python
#!pip install transformers[sentencepiece]
from transformers import pipeline
text = "Angela Merkel is a politician in Germany and leader of the CDU"
hypothesis_template = "This text is about {}"
classes_verbalized = ["politics", "economy", "entertainment", "environment"]
zeroshot_classifier = pipeline("zero-shot-classification", model="MoritzLaurer/deberta-v3-large-zeroshot-v2.0")  # change the model identifier here
output = zeroshot_classifier(text, classes_verbalized, hypothesis_template=hypothesis_template, multi_label=False)
print(output)
```

`multi_label=False` forces the model to decide on only one class. `multi_label=True` enables the model to choose multiple classes. 


## Metrics 

The models were evaluated on 28 different text classification tasks with the [f1_macro](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.f1_score.html) metric.
The main reference point is `facebook/bart-large-mnli` which is, at the time of writing (03.04.24), the most used commercially-friendly 0-shot classifier.

![results_aggreg_v2.0](https://raw.githubusercontent.com/MoritzLaurer/zeroshot-classifier/main/v2_synthetic_data/results/zeroshot-v2.0-aggreg.png)


|                            |   facebook/bart-large-mnli |   roberta-base-zeroshot-v2.0-c |   roberta-large-zeroshot-v2.0-c |   deberta-v3-base-zeroshot-v2.0-c |   deberta-v3-base-zeroshot-v2.0 (fewshot) |   deberta-v3-large-zeroshot-v2.0-c |   deberta-v3-large-zeroshot-v2.0 (fewshot) |   bge-m3-zeroshot-v2.0-c |   bge-m3-zeroshot-v2.0 (fewshot) |
|:---------------------------|---------------------------:|-----------------------------:|------------------------------:|--------------------------------:|-----------------------------------:|---------------------------------:|------------------------------------:|-----------------------:|--------------------------:|
| all datasets mean          |                      0.497 |                        0.587 |                         0.622 |                           0.619 |                                      0.643 (0.834) |                            0.676 |                                       0.673 (0.846) |                  0.59  |                     (0.803) |
| amazonpolarity (2)         |                      0.937 |                        0.924 |                         0.951 |                           0.937 |                                      0.943 (0.961) |                            0.952 |                                       0.956 (0.968) |                  0.942 |                     (0.951) |
| imdb (2)                   |                      0.892 |                        0.871 |                         0.904 |                           0.893 |                                      0.899 (0.936) |                            0.923 |                                       0.918 (0.958) |                  0.873 |                     (0.917) |
| appreviews (2)             |                      0.934 |                        0.913 |                         0.937 |                           0.938 |                                      0.945 (0.948) |                            0.943 |                                       0.949 (0.962) |                  0.932 |                     (0.954) |
| yelpreviews (2)            |                      0.948 |                        0.953 |                         0.977 |                
```
