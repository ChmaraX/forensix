# Authoritative licence sources for BAAI/bge-reranker-large


## README.md
Source: https://huggingface.co/BAAI/bge-reranker-large/raw/main/README.md

```
---
license: mit
language:
- en
- zh
tags:
- mteb
model-index:
- name: bge-reranker-base
  results:
  - task:
      type: Reranking
    dataset:
      type: C-MTEB/CMedQAv1-reranking
      name: MTEB CMedQAv1
      config: default
      split: test
      revision: None
    metrics:
    - type: map
      value: 81.27206722525007
    - type: mrr
      value: 84.14238095238095
  - task:
      type: Reranking
    dataset:
      type: C-MTEB/CMedQAv2-reranking
      name: MTEB CMedQAv2
      config: default
      split: test
      revision: None
    metrics:
    - type: map
      value: 84.10369934291236
    - type: mrr
      value: 86.79376984126984
  - task:
      type: Reranking
    dataset:
      type: C-MTEB/Mmarco-reranking
      name: MTEB MMarcoReranking
      config: default
      split: dev
      revision: None
    metrics:
    - type: map
      value: 35.4600511272538
    - type: mrr
      value: 34.60238095238095
  - task:
      type: Reranking
    dataset:
      type: C-MTEB/T2Reranking
      name: MTEB T2Reranking
      config: default
      split: dev
      revision: None
    metrics:
    - type: map
      value: 67.27728847727172
    - type: mrr
      value: 77.1315192743764
pipeline_tag: feature-extraction
---

**We have updated the [new reranker](https://github.com/FlagOpen/FlagEmbedding/tree/master/FlagEmbedding/llm_reranker), supporting larger lengths, more languages, and achieving better performance.**

<h1 align="center">FlagEmbedding</h1>


<h4 align="center">
    <p>
        <a href=#model-list>Model List</a> | 
        <a href=#frequently-asked-questions>FAQ</a> |
        <a href=#usage>Usage</a>  |
        <a href="#evaluation">Evaluation</a> |
        <a href="#train">Train</a> |
        <a href="#citation">Citation</a> |
        <a href="#license">License</a> 
    <p>
</h4>

**More details please refer to our Github: [FlagEmbedding](https://github.com/FlagOpen/FlagEmbedding).**


[English](README.md) | [中文](https://github.com/FlagOpen/FlagEmbedding/blob/master/README_zh.md)


FlagEmbedding focuses on retrieval-augmented LLMs, consisting of the following projects currently:

- **Long-Context LLM**: [Activation Beacon](https://github.com/FlagOpen/FlagEmbedding/tree/master/Long_LLM/activation_beacon)
- **Fine-tuning of LM** : [LM-Cocktail](https://github.com/FlagOpen/FlagEmbedding/tree/master/LM_Cocktail)
- **Embedding Model**: [Visualized-BGE](https://github.com/FlagOpen/FlagEmbedding/tree/master/FlagEmbedding/visual), [BGE-M3](https://github.com/FlagOpen/FlagEmbedding/tree/master/FlagEmbedding/BGE_M3), [LLM Embedder](https://github.com/FlagOpen/FlagEmbedding/tree/master/FlagEmbedding/llm_embedder), [BGE Embedding](https://github.com/FlagOpen/FlagEmbedding/tree/master/FlagEmbedding/baai_general_embedding)
- **Reranker Model**: [llm rerankers](https://github.com/FlagOpen/FlagEmbedding/tree/master/FlagEmbedding/llm_reranker), [BGE Reranker](https://github.com/FlagOpen/FlagEmbedding/tree/master/FlagEmbedding/reranker)
- **Benchmark**: [C-MTEB](https://github.com/FlagOpen/FlagEmbedding/tree/master/C_MTEB)

## News 
- 3/18/2024: Release new [rerankers](https://github.com/FlagOpen/FlagEmbedding/tree/master/FlagEmbedding/llm_reranker), built upon powerful M3 and LLM (GEMMA and MiniCPM, not so large actually) backbones, supporitng multi-lingual processing and larger inputs, massive improvements of ranking performances on BEIR, C-MTEB/Retrieval, MIRACL, LlamaIndex Evaluation.
- 3/18/2024: Release [Visualized-BGE](https://github.com/FlagOpen/FlagEmbedding/tree/master/FlagEmbedding/visual), equipping BGE with visual capabilities. Visualized-BGE can be utilized to generate embeddings for hybrid image-text data.
- 1/30/2024: Release **BGE-M3**, a new member to BGE model series! M3 stands for **M**ulti-linguality (100+ languages), **M**ulti-granularities (input length up to 8192), **M**ulti-Functionality (unification of dense, lexical, multi-vec/colbert retrieval). 
It is the first embedding model which supports all three retrieval methods, achieving new SOTA on multi-lingual (MIRACL) and cross-lingual (MKQA) benchmarks.
[Technical Report](https://github.com/FlagOpen/FlagEmbedding/blob/master/FlagEmbedding/BGE_M3/BGE_M3.pdf) and [Code](https://github.com/FlagOpen/FlagEmbedding/tree/master/FlagEmbedding/BGE_M3). :fire:
- 1/9/2024: Release [Activation-Beacon](https://github.com/FlagOpen/FlagEmbedding/tree/master/Long_LLM/activation_beacon), an effective, efficient, compatible, and low-cost (training) method to extend the context length of LLM. [Technical Report](https://arxiv.org/abs/2401.03462) :fire:
- 12/24/2023: Release **LLaRA**, a LLaMA-7B based dense retriever, leading to state-of-the-art performances on MS MARCO and BEIR. Model and code will be open-sourced. Please stay tuned. [Technical Report](https://arxiv.org/abs/2312.15503)
- 11/23/2023: Release [LM-Cocktail](https://github.com/FlagOpen/FlagEmbedding/tree/master/LM_Cocktail), a method to maintain general capabilities during fine-tuning by merging multiple language models. [Technical Report](https://arxiv.org/abs/2311.13534) :fire:  
- 10/12/2023: Release [LLM-Embedder](https://github.com/FlagOpen/FlagEmbedding/tree/master/FlagEmbedding/llm_embedder), a unified embedding model to support diverse retrieval augmentation needs for LLMs. [Technical Report](https://arxiv.org/pdf/2310.07554.pdf)
- 09/15/2023: The [technical report](https://arxiv.org/pdf/2309.07597.pdf) of BGE has been released 
- 09/15/2023: The [massive training data](https://data.baai.ac.cn/details/BAAI-MTP) of BGE has been released 
- 09/12/2023: New models: 
    - **New reranker model**: release cross-encoder models `BAAI/bge-reranker-base` and `BAAI/bge-reranker-large`, which are more powerful than embedding model. We recommend to use/fine-tune them to re-rank top-k documents returned by embedding models. 
    - **update embedding model**: release `bge-*-v1.5` embedding model to alleviate the issue of the similarity distribution, and enhance its retrieval
```
