# Authoritative licence sources for BAAI/bge-base-en-v1.5


## README.md
Source: https://huggingface.co/BAAI/bge-base-en-v1.5/raw/main/README.md

```
---
tags:
- sentence-transformers
- feature-extraction
- sentence-similarity
- transformers
- mteb
model-index:
- name: bge-base-en-v1.5
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
      value: 76.14925373134328
    - type: ap
      value: 39.32336517995478
    - type: f1
      value: 70.16902252611425
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
      value: 93.386825
    - type: ap
      value: 90.21276917991995
    - type: f1
      value: 93.37741030006174
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
      value: 48.846000000000004
    - type: f1
      value: 48.14646269778261
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
      value: 40.754000000000005
    - type: map_at_10
      value: 55.761
    - type: map_at_100
      value: 56.330999999999996
    - type: map_at_1000
      value: 56.333999999999996
    - type: map_at_3
      value: 51.92
    - type: map_at_5
      value: 54.010999999999996
    - type: mrr_at_1
      value: 41.181
    - type: mrr_at_10
      value: 55.967999999999996
    - type: mrr_at_100
      value: 56.538
    - type: mrr_at_1000
      value: 56.542
    - type: mrr_at_3
      value: 51.980000000000004
    - type: mrr_at_5
      value: 54.208999999999996
    - type: ndcg_at_1
      value: 40.754000000000005
    - type: ndcg_at_10
      value: 63.605000000000004
    - type: ndcg_at_100
      value: 66.05199999999999
    - type: ndcg_at_1000
      value: 66.12
    - type: ndcg_at_3
      value: 55.708
    - type: ndcg_at_5
      value: 59.452000000000005
    - type: precision_at_1
      value: 40.754000000000005
    - type: precision_at_10
      value: 8.841000000000001
    - type: precision_at_100
      value: 0.991
    - type: precision_at_1000
      value: 0.1
    - type: precision_at_3
      value: 22.238
    - type: precision_at_5
      value: 15.149000000000001
    - type: recall_at_1
      value: 40.754000000000005
    - type: recall_at_10
      value: 88.407
    - type: recall_at_100
      value: 99.14699999999999
    - type: recall_at_1000
      value: 99.644
    - type: recall_at_3
      value: 66.714
    - type: recall_at_5
      value: 75.747
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
      value: 48.74884539679369
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
      value: 42.8075893810716
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
      value: 62.128470519187736
    - type: mrr
      value: 74.28065778481289
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
      value: 89.24629081484655
    - type: cos_sim_spearman
      value: 86.93752309911496
    - type: euclidean_pearson
      value: 87.58589628573816
    - type: euclidean_spearman
      value: 88.05622328825284
    - type: manhattan_pearson
      value: 87.5594959805773
    - type: manhattan_spearman
      value: 88.19658793233961
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
      value: 86.9512987012987
    - type: f1
      value: 86.92515357973708
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
      value: 39.10263762928872
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
      value: 36.69711517426737
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
      value: 32.327
    - type: map_at_10
      value: 44.099
    - type: map_at_100
      value: 45.525
    - type: map_at_1000
      value: 45.641999999999996
    - type: map_at_3
      value: 40.47
    - type: map_at_5
      value: 42.36
    - type: mrr_at_1
      value: 39.199
    - type: mrr_at_10
      value: 49.651
    - type: mrr_at_100
      value: 50.29
    - type: mrr_at_1000
      value: 50.329
    - type: mrr_at_3
      value: 46.924
    - type: mrr_at_5
      value: 48.54
```
