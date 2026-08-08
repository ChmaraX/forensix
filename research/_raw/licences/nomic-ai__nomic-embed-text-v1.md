# Authoritative licence sources for nomic-ai/nomic-embed-text-v1


## README.md
Source: https://huggingface.co/nomic-ai/nomic-embed-text-v1/raw/main/README.md

```
---
library_name: sentence-transformers
pipeline_tag: sentence-similarity
tags:
- feature-extraction
- sentence-similarity
- mteb
- transformers
- transformers.js
model-index:
- name: epoch_0_model
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
      value: 76.8507462686567
    - type: ap
      value: 40.592189159090495
    - type: f1
      value: 71.01634655512476
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
      value: 91.51892500000001
    - type: ap
      value: 88.50346762975335
    - type: f1
      value: 91.50342077459624
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
      value: 47.364
    - type: f1
      value: 46.72708080922794
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
      value: 25.178
    - type: map_at_10
      value: 40.244
    - type: map_at_100
      value: 41.321999999999996
    - type: map_at_1000
      value: 41.331
    - type: map_at_3
      value: 35.016999999999996
    - type: map_at_5
      value: 37.99
    - type: mrr_at_1
      value: 25.605
    - type: mrr_at_10
      value: 40.422000000000004
    - type: mrr_at_100
      value: 41.507
    - type: mrr_at_1000
      value: 41.516
    - type: mrr_at_3
      value: 35.23
    - type: mrr_at_5
      value: 38.15
    - type: ndcg_at_1
      value: 25.178
    - type: ndcg_at_10
      value: 49.258
    - type: ndcg_at_100
      value: 53.776
    - type: ndcg_at_1000
      value: 53.995000000000005
    - type: ndcg_at_3
      value: 38.429
    - type: ndcg_at_5
      value: 43.803
    - type: precision_at_1
      value: 25.178
    - type: precision_at_10
      value: 7.831
    - type: precision_at_100
      value: 0.979
    - type: precision_at_1000
      value: 0.1
    - type: precision_at_3
      value: 16.121
    - type: precision_at_5
      value: 12.29
    - type: recall_at_1
      value: 25.178
    - type: recall_at_10
      value: 78.307
    - type: recall_at_100
      value: 97.866
    - type: recall_at_1000
      value: 99.57300000000001
    - type: recall_at_3
      value: 48.364000000000004
    - type: recall_at_5
      value: 61.451
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
      value: 45.93034494751465
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
      value: 36.64579480054327
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
      value: 60.601310529222054
    - type: mrr
      value: 75.04484896451656
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
      value: 88.57797718095814
    - type: cos_sim_spearman
      value: 86.47064499110101
    - type: euclidean_pearson
      value: 87.4559602783142
    - type: euclidean_spearman
      value: 86.47064499110101
    - type: manhattan_pearson
      value: 87.7232764230245
    - type: manhattan_spearman
      value: 86.91222131777742
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
      value: 84.5422077922078
    - type: f1
      value: 84.47657456950589
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
      value: 38.48953561974464
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
      value: 32.75995857510105
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
      value: 30.008000000000003
    - type: map_at_10
      value: 39.51
    - type: map_at_100
      value: 40.841
    - type: map_at_1000
      value: 40.973
    - type: map_at_3
      value: 36.248999999999995
    - type: map_at_5
      value: 38.096999999999994
    - type: mrr_at_1
      value: 36.481
    - type: mrr_at_10
      value: 44.818000000000005
    - type: mrr_at_100
      value: 45.64
    - type: mrr_at_1000
      value: 45.687
    - type: mrr_at_3
      value: 42.036
    - type: mrr_at_5
      value: 43.782
    - type: ndcg_at_1
   
```
