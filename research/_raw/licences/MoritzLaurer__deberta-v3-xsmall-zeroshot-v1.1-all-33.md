# Authoritative licence sources for MoritzLaurer/deberta-v3-xsmall-zeroshot-v1.1-all-33


## README.md
Source: https://huggingface.co/MoritzLaurer/deberta-v3-xsmall-zeroshot-v1.1-all-33/raw/main/README.md

```
---
base_model: microsoft/deberta-v3-xsmall
language:
- en
tags:
- text-classification
- zero-shot-classification
pipeline_tag: zero-shot-classification
library_name: transformers
license: mit
---


# deberta-v3-xsmall-zeroshot-v1.1-all-33 

This model was fine-tuned using the same pipeline as described in 
the model card for [MoritzLaurer/deberta-v3-large-zeroshot-v1.1-all-33](https://huggingface.co/MoritzLaurer/deberta-v3-large-zeroshot-v1.1-all-33)
and in this [paper](https://arxiv.org/pdf/2312.17543.pdf).
 
The foundation model is [microsoft/deberta-v3-xsmall](https://huggingface.co/microsoft/deberta-v3-xsmall).
The model only has 22 million backbone parameters and 128 million vocabulary parameters. 
The backbone parameters are the main parameters active during inference, providing a significant speedup over larger models. 
The model is 142 MB small.

This model was trained to provide a small and highly efficient zeroshot option, 
especially for edge devices or in-browser use-cases with transformers.js.

## Usage and other details
For usage instructions and other details refer to 
this model card [MoritzLaurer/deberta-v3-large-zeroshot-v1.1-all-33](https://huggingface.co/MoritzLaurer/deberta-v3-large-zeroshot-v1.1-all-33)
and this [paper](https://arxiv.org/pdf/2312.17543.pdf).

## Metrics:

I didn't not do zeroshot evaluation for this model to save time and compute. 
The table below shows standard accuracy for all datasets the model was trained on (note that the NLI datasets are binary).

General takeaway: the model is much more efficient than its larger sisters, but it performs less well. 

|Datasets|mnli_m|mnli_mm|fevernli|anli_r1|anli_r2|anli_r3|wanli|lingnli|wellformedquery|rottentomatoes|amazonpolarity|imdb|yelpreviews|hatexplain|massive|banking77|emotiondair|emocontext|empathetic|agnews|yahootopics|biasframes_sex|biasframes_offensive|biasframes_intent|financialphrasebank|appreviews|hateoffensive|trueteacher|spam|wikitoxic_toxicaggregated|wikitoxic_obscene|wikitoxic_identityhate|wikitoxic_threat|wikitoxic_insult|manifesto|capsotu|
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
|Accuracy|0.925|0.923|0.886|0.732|0.633|0.661|0.814|0.887|0.722|0.872|0.944|0.925|0.967|0.774|0.734|0.627|0.762|0.745|0.465|0.888|0.702|0.94|0.853|0.863|0.914|0.926|0.921|0.635|0.968|0.897|0.918|0.915|0.935|0.9|0.505|0.701|
|Inference text/sec (A10G, batch=128)|1573.0|1630.0|683.0|1282.0|1352.0|1072.0|2325.0|2008.0|4781.0|2743.0|677.0|228.0|238.0|2357.0|5027.0|4323.0|3247.0|3129.0|941.0|1643.0|335.0|1517.0|1452.0|1498.0|2367.0|974.0|2634.0|353.0|2284.0|260.0|252.0|256.0|254.0|259.0|1941.0|2080.0|




```
