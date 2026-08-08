# Authoritative licence sources for WhereIsAI/UAE-Large-V1


## README.md
Source: https://huggingface.co/WhereIsAI/UAE-Large-V1/raw/main/README.md

```
---
tags:
- mteb
- sentence_embedding
- feature_extraction
- sentence-transformers
- transformers
- transformers.js
model-index:
- name: UAE-Large-V1
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
      value: 75.55223880597015
    - type: ap
      value: 38.264070815317794
    - type: f1
      value: 69.40977934769845
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
      value: 92.84267499999999
    - type: ap
      value: 89.57568507997713
    - type: f1
      value: 92.82590734337774
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
      value: 48.292
    - type: f1
      value: 47.90257816032778
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
      value: 42.105
    - type: map_at_10
      value: 58.181000000000004
    - type: map_at_100
      value: 58.653999999999996
    - type: map_at_1000
      value: 58.657000000000004
    - type: map_at_3
      value: 54.386
    - type: map_at_5
      value: 56.757999999999996
    - type: mrr_at_1
      value: 42.745
    - type: mrr_at_10
      value: 58.437
    - type: mrr_at_100
      value: 58.894999999999996
    - type: mrr_at_1000
      value: 58.897999999999996
    - type: mrr_at_3
      value: 54.635
    - type: mrr_at_5
      value: 56.99999999999999
    - type: ndcg_at_1
      value: 42.105
    - type: ndcg_at_10
      value: 66.14999999999999
    - type: ndcg_at_100
      value: 68.048
    - type: ndcg_at_1000
      value: 68.11399999999999
    - type: ndcg_at_3
      value: 58.477000000000004
    - type: ndcg_at_5
      value: 62.768
    - type: precision_at_1
      value: 42.105
    - type: precision_at_10
      value: 9.110999999999999
    - type: precision_at_100
      value: 0.991
    - type: precision_at_1000
      value: 0.1
    - type: precision_at_3
      value: 23.447000000000003
    - type: precision_at_5
      value: 16.159000000000002
    - type: recall_at_1
      value: 42.105
    - type: recall_at_10
      value: 91.11
    - type: recall_at_100
      value: 99.14699999999999
    - type: recall_at_1000
      value: 99.644
    - type: recall_at_3
      value: 70.341
    - type: recall_at_5
      value: 80.797
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
      value: 49.02580759154173
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
      value: 43.093601280163554
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
      value: 64.19590406875427
    - type: mrr
      value: 77.09547992788991
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
      value: 87.86678362843676
    - type: cos_sim_spearman
      value: 86.1423242570783
    - type: euclidean_pearson
      value: 85.98994198511751
    - type: euclidean_spearman
      value: 86.48209103503942
    - type: manhattan_pearson
      value: 85.6446436316182
    - type: manhattan_spearman
      value: 86.21039809734357
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
      value: 87.69155844155844
    - type: f1
      value: 87.68109381943547
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
      value: 39.37501687500394
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
      value: 37.23401405155885
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
      value: 30.232
    - type: map_at_10
      value: 41.404999999999994
    - type: map_at_100
      value: 42.896
    - type: map_at_1000
      value: 43.028
    - type: map_at_3
      value: 37.925
    - type: map_at_5
      value: 39.865
    - type: mrr_at_1
      value: 36.338
    - type: mrr_at_10
      value: 46.969
    - type: mrr_at_100
      value: 47.684
    - type: mrr_at_1000
      value: 47.731
    - type: mrr_at_3
      value: 44.063
    - type: mrr_at_5
      value: 45.908
    - typ
```
