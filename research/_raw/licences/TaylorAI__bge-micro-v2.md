# Authoritative licence sources for TaylorAI/bge-micro-v2


## README.md
Source: https://huggingface.co/TaylorAI/bge-micro-v2/raw/main/README.md

```
---
pipeline_tag: sentence-similarity
tags:
- sentence-transformers
- feature-extraction
- sentence-similarity
- transformers
- mteb
model-index:
- name: bge_micro
  results:
  - task:
      type: Classification
    dataset:
      type: mteb/amazon_counterfactual
      name: MTEB AmazonCounterfactualClassification (en)
      config: en
      split: test
      revision: e8379541af4e31359cca9fbcf4b00f2671dba205
    metrics:
    - type: accuracy
      value: 67.76119402985074
    - type: ap
      value: 29.637849284211114
    - type: f1
      value: 61.31181187111905
  - task:
      type: Classification
    dataset:
      type: mteb/amazon_polarity
      name: MTEB AmazonPolarityClassification
      config: default
      split: test
      revision: e2d317d38cd51312af73b3d32a06d1a08b442046
    metrics:
    - type: accuracy
      value: 79.7547
    - type: ap
      value: 74.21401629809145
    - type: f1
      value: 79.65319615433783
  - task:
      type: Classification
    dataset:
      type: mteb/amazon_reviews_multi
      name: MTEB AmazonReviewsClassification (en)
      config: en
      split: test
      revision: 1399c76144fd37290681b995c656ef9b2e06e26d
    metrics:
    - type: accuracy
      value: 37.452000000000005
    - type: f1
      value: 37.0245198854966
  - task:
      type: Retrieval
    dataset:
      type: arguana
      name: MTEB ArguAna
      config: default
      split: test
      revision: None
    metrics:
    - type: map_at_1
      value: 31.152
    - type: map_at_10
      value: 46.702
    - type: map_at_100
      value: 47.563
    - type: map_at_1000
      value: 47.567
    - type: map_at_3
      value: 42.058
    - type: map_at_5
      value: 44.608
    - type: mrr_at_1
      value: 32.006
    - type: mrr_at_10
      value: 47.064
    - type: mrr_at_100
      value: 47.910000000000004
    - type: mrr_at_1000
      value: 47.915
    - type: mrr_at_3
      value: 42.283
    - type: mrr_at_5
      value: 44.968
    - type: ndcg_at_1
      value: 31.152
    - type: ndcg_at_10
      value: 55.308
    - type: ndcg_at_100
      value: 58.965
    - type: ndcg_at_1000
      value: 59.067
    - type: ndcg_at_3
      value: 45.698
    - type: ndcg_at_5
      value: 50.296
    - type: precision_at_1
      value: 31.152
    - type: precision_at_10
      value: 8.279
    - type: precision_at_100
      value: 0.987
    - type: precision_at_1000
      value: 0.1
    - type: precision_at_3
      value: 18.753
    - type: precision_at_5
      value: 13.485
    - type: recall_at_1
      value: 31.152
    - type: recall_at_10
      value: 82.788
    - type: recall_at_100
      value: 98.72
    - type: recall_at_1000
      value: 99.502
    - type: recall_at_3
      value: 56.259
    - type: recall_at_5
      value: 67.425
  - task:
      type: Clustering
    dataset:
      type: mteb/arxiv-clustering-p2p
      name: MTEB ArxivClusteringP2P
      config: default
      split: test
      revision: a122ad7f3f0291bf49cc6f4d32aa80929df69d5d
    metrics:
    - type: v_measure
      value: 44.52692241938116
  - task:
      type: Clustering
    dataset:
      type: mteb/arxiv-clustering-s2s
      name: MTEB ArxivClusteringS2S
      config: default
      split: test
      revision: f910caf1a6075f7329cdf8c1a6135696f37dbd53
    metrics:
    - type: v_measure
      value: 33.245710292773595
  - task:
      type: Reranking
    dataset:
      type: mteb/askubuntudupquestions-reranking
      name: MTEB AskUbuntuDupQuestions
      config: default
      split: test
      revision: 2000358ca161889fa9c082cb41daa8dcfb161a54
    metrics:
    - type: map
      value: 58.08493637155168
    - type: mrr
      value: 71.94378490084861
  - task:
      type: STS
    dataset:
      type: mteb/biosses-sts
      name: MTEB BIOSSES
      config: default
      split: test
      revision: d3fb88f8f02e40887cd149695127462bbcf29b4a
    metrics:
    - type: cos_sim_pearson
      value: 84.1602804378326
    - type: cos_sim_spearman
      value: 82.92478106365587
    - type: euclidean_pearson
      value: 82.27930167277077
    - type: euclidean_spearman
      value: 82.18560759458093
    - type: manhattan_pearson
      value: 82.34277425888187
    - type: manhattan_spearman
      value: 81.72776583704467
  - task:
      type: Classification
    dataset:
      type: mteb/banking77
      name: MTEB Banking77Classification
      config: default
      split: test
      revision: 0fd18e25b25c072e09e0d92ab615fda904d66300
    metrics:
    - type: accuracy
      value: 81.17207792207792
    - type: f1
      value: 81.09893836310513
  - task:
      type: Clustering
    dataset:
      type: mteb/biorxiv-clustering-p2p
      name: MTEB BiorxivClusteringP2P
      config: default
      split: test
      revision: 65b79d1d13f80053f67aca9498d9402c2d9f1f40
    metrics:
    - type: v_measure
      value: 36.109308463095516
  - task:
      type: Clustering
    dataset:
      type: mteb/biorxiv-clustering-s2s
      name: MTEB BiorxivClusteringS2S
      config: default
      split: test
      revision: 258694dd0231531bc1fd9de6ceb52a0853c6d908
    metrics:
    - type: v_measure
      value: 28.06048212317168
  - task:
      type: Retrieval
    dataset:
      type: BeIR/cqadupstack
      name: MTEB CQADupstackAndroidRetrieval
      config: default
      split: test
      revision: None
    metrics:
    - type: map_at_1
      value: 28.233999999999998
    - type: map_at_10
      value: 38.092999999999996
    - type: map_at_100
      value: 39.473
    - type: map_at_1000
      value: 39.614
    - type: map_at_3
      value: 34.839
    - type: map_at_5
      value: 36.523
    - type: mrr_at_1
      value: 35.193000000000005
    - type: mrr_at_10
      value: 44.089
    - type: mrr_at_100
      value: 44.927
    - type: mrr_at_1000
      value: 44.988
    - type: mrr_at_3
      value: 41.559000000000005
    - type: mrr_at_5
      value: 43.162
    - type: ndcg_at_1
      value: 35.193000000000005
    - type: ndcg_at_10
      value: 44.04
    - type: 
```

## LICENSE
Source: https://huggingface.co/TaylorAI/bge-micro-v2/raw/main/LICENSE

```
MIT License

Copyright (c) 2023 Benjamin Anderson

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
