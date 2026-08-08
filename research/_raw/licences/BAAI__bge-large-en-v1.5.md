# Authoritative licence sources for BAAI/bge-large-en-v1.5


## README.md
Source: https://huggingface.co/BAAI/bge-large-en-v1.5/raw/main/README.md

```
---
tags:
- sentence-transformers
- feature-extraction
- sentence-similarity
- transformers
- mteb
model-index:
- name: bge-large-en-v1.5
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
      value: 75.8507462686567
    - type: ap
      value: 38.566457320228245
    - type: f1
      value: 69.69386648043475
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
      value: 92.416675
    - type: ap
      value: 89.1928861155922
    - type: f1
      value: 92.39477019574215
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
      value: 48.175999999999995
    - type: f1
      value: 47.80712792870253
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
      value: 40.184999999999995
    - type: map_at_10
      value: 55.654
    - type: map_at_100
      value: 56.25
    - type: map_at_1000
      value: 56.255
    - type: map_at_3
      value: 51.742999999999995
    - type: map_at_5
      value: 54.129000000000005
    - type: mrr_at_1
      value: 40.967
    - type: mrr_at_10
      value: 55.96
    - type: mrr_at_100
      value: 56.54900000000001
    - type: mrr_at_1000
      value: 56.554
    - type: mrr_at_3
      value: 51.980000000000004
    - type: mrr_at_5
      value: 54.44
    - type: ndcg_at_1
      value: 40.184999999999995
    - type: ndcg_at_10
      value: 63.542
    - type: ndcg_at_100
      value: 65.96499999999999
    - type: ndcg_at_1000
      value: 66.08699999999999
    - type: ndcg_at_3
      value: 55.582
    - type: ndcg_at_5
      value: 59.855000000000004
    - type: precision_at_1
      value: 40.184999999999995
    - type: precision_at_10
      value: 8.841000000000001
    - type: precision_at_100
      value: 0.987
    - type: precision_at_1000
      value: 0.1
    - type: precision_at_3
      value: 22.238
    - type: precision_at_5
      value: 15.405
    - type: recall_at_1
      value: 40.184999999999995
    - type: recall_at_10
      value: 88.407
    - type: recall_at_100
      value: 98.72
    - type: recall_at_1000
      value: 99.644
    - type: recall_at_3
      value: 66.714
    - type: recall_at_5
      value: 77.027
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
      value: 48.567077926750066
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
      value: 43.19453389182364
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
      value: 64.46555939623092
    - type: mrr
      value: 77.82361605768807
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
      value: 84.9554128814735
    - type: cos_sim_spearman
      value: 84.65373612172036
    - type: euclidean_pearson
      value: 83.2905059954138
    - type: euclidean_spearman
      value: 84.52240782811128
    - type: manhattan_pearson
      value: 82.99533802997436
    - type: manhattan_spearman
      value: 84.20673798475734
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
      value: 87.78896103896103
    - type: f1
      value: 87.77189310964883
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
      value: 39.714538337650495
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
      value: 36.90108349284447
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
      value: 32.795
    - type: map_at_10
      value: 43.669000000000004
    - type: map_at_100
      value: 45.151
    - type: map_at_1000
      value: 45.278
    - type: map_at_3
      value: 40.006
    - type: map_at_5
      value: 42.059999999999995
    - type: mrr_at_1
      value: 39.771
    - type: mrr_at_10
      value: 49.826
    - type: mrr_at_100
      value: 50.504000000000005
    - type: mrr_at_1000
      value: 50.549
    - type: mrr_at_3
      value: 47.115
    - type: mrr_at_5
      value: 48.832
    - type: ndcg_at_
```
