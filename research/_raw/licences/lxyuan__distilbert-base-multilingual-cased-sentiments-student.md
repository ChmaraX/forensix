# Authoritative licence sources for lxyuan/distilbert-base-multilingual-cased-sentiments-student


## README.md
Source: https://huggingface.co/lxyuan/distilbert-base-multilingual-cased-sentiments-student/raw/main/README.md

```
---
license: apache-2.0
tags:
- sentiment-analysis
- text-classification
- zero-shot-distillation
- distillation
- zero-shot-classification
- debarta-v3
model-index:
- name: distilbert-base-multilingual-cased-sentiments-student
  results: []
datasets:
- tyqiangz/multilingual-sentiments
language:
- en
- ar
- de
- es
- fr
- ja
- zh
- id
- hi
- it
- ms
- pt
---

<!-- This model card has been generated automatically according to the information the Trainer had access to. You
should probably proofread and complete it, then remove this comment. -->

# distilbert-base-multilingual-cased-sentiments-student

This model is distilled from the zero-shot classification pipeline on the Multilingual Sentiment 
dataset using this [script](https://github.com/huggingface/transformers/tree/main/examples/research_projects/zero-shot-distillation). 

In reality the multilingual-sentiment dataset is annotated of course, 
but we'll pretend and ignore the annotations for the sake of example.


    Teacher model: MoritzLaurer/mDeBERTa-v3-base-mnli-xnli
    Teacher hypothesis template: "The sentiment of this text is {}."
    Student model: distilbert-base-multilingual-cased


## Inference example

```python
from transformers import pipeline

distilled_student_sentiment_classifier = pipeline(
    model="lxyuan/distilbert-base-multilingual-cased-sentiments-student", 
    return_all_scores=True
)

# english
distilled_student_sentiment_classifier ("I love this movie and i would watch it again and again!")
>> [[{'label': 'positive', 'score': 0.9731044769287109},
  {'label': 'neutral', 'score': 0.016910076141357422},
  {'label': 'negative', 'score': 0.009985478594899178}]]

# malay
distilled_student_sentiment_classifier("Saya suka filem ini dan saya akan menontonnya lagi dan lagi!")
[[{'label': 'positive', 'score': 0.9760093688964844},
  {'label': 'neutral', 'score': 0.01804516464471817},
  {'label': 'negative', 'score': 0.005945465061813593}]]

# japanese
distilled_student_sentiment_classifier("私はこの映画が大好きで、何度も見ます！")
>> [[{'label': 'positive', 'score': 0.9342429041862488},
  {'label': 'neutral', 'score': 0.040193185210227966},
  {'label': 'negative', 'score': 0.025563929229974747}]]


```


## Training procedure

Notebook link: [here](https://github.com/LxYuan0420/nlp/blob/main/notebooks/Distilling_Zero_Shot_multilingual_distilbert_sentiments_student.ipynb)

### Training hyperparameters

Result can be reproduce using the following commands:

```bash
python transformers/examples/research_projects/zero-shot-distillation/distill_classifier.py \
--data_file ./multilingual-sentiments/train_unlabeled.txt \
--class_names_file ./multilingual-sentiments/class_names.txt \
--hypothesis_template "The sentiment of this text is {}." \
--teacher_name_or_path MoritzLaurer/mDeBERTa-v3-base-mnli-xnli \
--teacher_batch_size 32 \
--student_name_or_path distilbert-base-multilingual-cased \
--output_dir ./distilbert-base-multilingual-cased-sentiments-student \
--per_device_train_batch_size 16 \
--fp16
```

If you are training this model on Colab, make the following code changes to avoid Out-of-memory error message:
```bash
###### modify L78 to disable fast tokenizer 
default=False,

###### update dataset map part at L313
dataset = dataset.map(tokenizer, input_columns="text", fn_kwargs={"padding": "max_length", "truncation": True, "max_length": 512})

###### add following lines to L213
del model
print(f"Manually deleted Teacher model, free some memory for student model.")

###### add following lines to L337
trainer.push_to_hub()
tokenizer.push_to_hub("distilbert-base-multilingual-cased-sentiments-student")
  
```

### Training log
```bash

Training completed. Do not forget to share your model on huggingface.co/models =)

{'train_runtime': 2009.8864, 'train_samples_per_second': 73.0, 'train_steps_per_second': 4.563, 'train_loss': 0.6473459283913797, 'epoch': 1.0}
100%|███████████████████████████████████████| 9171/9171 [33:29<00:00,  4.56it/s]
[INFO|trainer.py:762] 2023-05-06 10:56:18,555 >> The following columns in the evaluation set don't have a corresponding argument in `DistilBertForSequenceClassification.forward` and have been ignored: text. If text are not expected by `DistilBertForSequenceClassification.forward`,  you can safely ignore this message.
[INFO|trainer.py:3129] 2023-05-06 10:56:18,557 >> ***** Running Evaluation *****
[INFO|trainer.py:3131] 2023-05-06 10:56:18,557 >>   Num examples = 146721
[INFO|trainer.py:3134] 2023-05-06 10:56:18,557 >>   Batch size = 128
100%|███████████████████████████████████████| 1147/1147 [08:59<00:00,  2.13it/s]
05/06/2023 11:05:18 - INFO - __main__ - Agreement of student and teacher predictions: 88.29%
[INFO|trainer.py:2868] 2023-05-06 11:05:18,251 >> Saving model checkpoint to ./distilbert-base-multilingual-cased-sentiments-student
[INFO|configuration_utils.py:457] 2023-05-06 11:05:18,251 >> Configuration saved in ./distilbert-base-multilingual-cased-sentiments-student/config.json
[INFO|modeling_utils.py:1847] 2023-05-06 11:05:18,905 >> Model weights saved in ./distilbert-base-multilingual-cased-sentiments-student/pytorch_model.bin
[INFO|tokenization_utils_base.py:2171] 2023-05-06 11:05:18,905 >> tokenizer config file saved in ./distilbert-base-multilingual-cased-sentiments-student/tokenizer_config.json
[INFO|tokenization_utils_base.py:2178] 2023-05-06 11:05:18,905 >> Special tokens file saved in ./distilbert-base-multilingual-cased-sentiments-student/special_tokens_map.json

```

### Framework versions

- Transformers 4.28.1
- Pytorch 2.0.0+cu118
- Datasets 2.11.0
- Tokenizers 0.13.3
```
