# Authoritative licence sources for jinaai/jina-embeddings-v2-small-en


## README.md
Source: https://huggingface.co/jinaai/jina-embeddings-v2-small-en/raw/main/README.md

```
---
tags:
  - sentence-transformers
  - feature-extraction
  - sentence-similarity
  - mteb
datasets:
  - jinaai/negation-dataset
language: en
inference: false
license: apache-2.0
model-index:
- name: jina-embedding-s-en-v2
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
      value: 71.35820895522387
    - type: ap
      value: 33.99931933598115
    - type: f1
      value: 65.3853685535555
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
      value: 82.90140000000001
    - type: ap
      value: 78.01434597815617
    - type: f1
      value: 82.83357802722676
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
      value: 40.88999999999999
    - type: f1
      value: 39.209432767163456
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
      value: 23.257
    - type: map_at_10
      value: 37.946000000000005
    - type: map_at_100
      value: 39.17
    - type: map_at_1000
      value: 39.181
    - type: map_at_3
      value: 32.99
    - type: map_at_5
      value: 35.467999999999996
    - type: mrr_at_1
      value: 23.541999999999998
    - type: mrr_at_10
      value: 38.057
    - type: mrr_at_100
      value: 39.289
    - type: mrr_at_1000
      value: 39.299
    - type: mrr_at_3
      value: 33.096
    - type: mrr_at_5
      value: 35.628
    - type: ndcg_at_1
      value: 23.257
    - type: ndcg_at_10
      value: 46.729
    - type: ndcg_at_100
      value: 51.900999999999996
    - type: ndcg_at_1000
      value: 52.16
    - type: ndcg_at_3
      value: 36.323
    - type: ndcg_at_5
      value: 40.766999999999996
    - type: precision_at_1
      value: 23.257
    - type: precision_at_10
      value: 7.510999999999999
    - type: precision_at_100
      value: 0.976
    - type: precision_at_1000
      value: 0.1
    - type: precision_at_3
      value: 15.339
    - type: precision_at_5
      value: 11.350999999999999
    - type: recall_at_1
      value: 23.257
    - type: recall_at_10
      value: 75.107
    - type: recall_at_100
      value: 97.58200000000001
    - type: recall_at_1000
      value: 99.57300000000001
    - type: recall_at_3
      value: 46.017
    - type: recall_at_5
      value: 56.757000000000005
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
      value: 44.02420878391967
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
      value: 35.16136856000258
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
      value: 59.61809790513646
    - type: mrr
      value: 73.07215406938397
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
      value: 82.0167350090749
    - type: cos_sim_spearman
      value: 80.51569002630401
    - type: euclidean_pearson
      value: 81.46820525099726
    - type: euclidean_spearman
      value: 80.51569002630401
    - type: manhattan_pearson
      value: 81.35596555056757
    - type: manhattan_spearman
      value: 80.12592210903303
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
      value: 78.25
    - type: f1
      value: 77.34950913540605
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
      value: 35.57238596005698
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
      value: 29.066444306196683
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
      value: 31.891000000000002
    - type: map_at_10
      value: 42.772
    - type: map_at_100
      value: 44.108999999999995
    - type: map_at_1000
      value: 44.236
    - type: map_at_3
      value: 39.289
    - type: map_at_5
      value: 41.113
    - type: mrr_at_1
      value: 39.342
    - type: mrr_at_10
      value: 48.852000000000004
    - type: mrr_at_100
      value: 49.534
    - type: mrr_at_1000
      value: 49.582
    - type: mrr_at_3
      value: 46.08999
```
