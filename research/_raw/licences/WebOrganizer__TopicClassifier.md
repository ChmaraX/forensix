# Authoritative licence sources for WebOrganizer/TopicClassifier

## README.md
Source: https://huggingface.co/WebOrganizer/TopicClassifier/raw/main/README.md
HTTP 200, 3800 chars (FULL, untruncated)

```
---
library_name: transformers
datasets:
- WebOrganizer/TopicAnnotations-Llama-3.1-8B
- WebOrganizer/TopicAnnotations-Llama-3.1-405B-FP8
base_model:
- Alibaba-NLP/gte-base-en-v1.5
---
# WebOrganizer/TopicClassifier

[[Paper](https://arxiv.org/abs/2502.10341)] [[Website](https://weborganizer.allenai.org)] [[GitHub](https://github.com/CodeCreator/WebOrganizer)]

The TopicClassifier organizes web content into 24 categories based on the URL and text contents of web pages.
The model is a [gte-base-en-v1.5](https://huggingface.co/Alibaba-NLP/gte-base-en-v1.5) with 140M parameters fine-tuned on the following training data:
1. [WebOrganizer/TopicAnnotations-Llama-3.1-8B](https://huggingface.co/datasets/WebOrganizer/TopicAnnotations-Llama-3.1-8B): 1M documents annotated by Llama-3.1-8B (first-stage training)
2. [WebOrganizer/TopicAnnotations-Llama-3.1-405B-FP8](https://huggingface.co/datasets/WebOrganizer/TopicAnnotations-Llama-3.1-405B-FP8): 100K documents annotated by Llama-3.1-405B-FP8 (second-stage training)

#### All Domain Classifiers
- [WebOrganizer/FormatClassifier](https://huggingface.co/WebOrganizer/FormatClassifier)
- [WebOrganizer/FormatClassifier-NoURL](https://huggingface.co/WebOrganizer/FormatClassifier-NoURL)
- [WebOrganizer/TopicClassifier](https://huggingface.co/WebOrganizer/TopicClassifier) *← you are here!*
- [WebOrganizer/TopicClassifier-NoURL](https://huggingface.co/WebOrganizer/TopicClassifier-NoURL)

## Usage

This classifier expects input in the following input format:
```
{url}

{text}
```

Example:
```python
from transformers import AutoTokenizer, AutoModelForSequenceClassification

tokenizer = AutoTokenizer.from_pretrained("WebOrganizer/TopicClassifier")
model = AutoModelForSequenceClassification.from_pretrained(
    "WebOrganizer/TopicClassifier",
    trust_remote_code=True,
    use_memory_efficient_attention=False)

web_page = """http://www.example.com

How to build a computer from scratch? Here are the components you need..."""

inputs = tokenizer([web_page], return_tensors="pt")
outputs = model(**inputs)

probs = outputs.logits.softmax(dim=-1)
print(probs.argmax(dim=-1))
# -> 5 ("Hardware" topic)
```

You can convert the `logits` of the model with a softmax to obtain a probability distribution over the following 24 categories (in order of labels, also see `id2label` and `label2id` in the model config):
1. Adult
2. Art & Design
3. Software Dev.
4. Crime & Law
5. Education & Jobs
6. Hardware
7. Entertainment
8. Social Life
9. Fashion & Beauty
10. Finance & Business
11. Food & Dining
12. Games
13. Health
14. History
15. Home & Hobbies
16. Industrial
17. Literature
18. Politics
19. Religion
20. Science & Tech.
21. Software
22. Sports & Fitness
23. Transportation
24. Travel

The full definitions of the categories can be found in the [taxonomy config](https://github.com/CodeCreator/WebOrganizer/blob/main/define_domains/taxonomies/topics.yaml).

#### Efficient Inference
We recommend that you use the efficient gte-base-en-v1.5 implementation by enabling unpadding and memory efficient attention. This __requires installing `xformers`__ (see more [here](https://huggingface.co/Alibaba-NLP/new-impl#recommendation-enable-unpadding-and-acceleration-with-xformers)) and loading the model like:
```python
AutoModelForSequenceClassification.from_pretrained(
    "WebOrganizer/TopicClassifier",
    trust_remote_code=True,
    unpad_inputs=True,
    use_memory_efficient_attention=True,
    torch_dtype=torch.bfloat16
)
```

## Citation
```bibtex
@article{wettig2025organize,
  title={Organize the Web: Constructing Domains Enhances Pre-Training Data Curation},
  author={Alexander Wettig and Kyle Lo and Sewon Min and Hannaneh Hajishirzi and Danqi Chen and Luca Soldaini},
  journal={arXiv preprint arXiv:2502.10341},
  year={2025}
}
```
```

## LICENSE
Source: https://huggingface.co/WebOrganizer/TopicClassifier/raw/main/LICENSE
HTTP 404 — NOT PRESENT

## LICENSE.txt
Source: https://huggingface.co/WebOrganizer/TopicClassifier/raw/main/LICENSE.txt
HTTP 404 — NOT PRESENT

## LICENSE.md
Source: https://huggingface.co/WebOrganizer/TopicClassifier/raw/main/LICENSE.md
HTTP 404 — NOT PRESENT

## NOTICE
Source: https://huggingface.co/WebOrganizer/TopicClassifier/raw/main/NOTICE
HTTP 404 — NOT PRESENT
