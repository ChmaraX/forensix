# Authoritative licence sources for nomic-ai/nomic-embed-text-v1.5


## README.md
Source: https://huggingface.co/nomic-ai/nomic-embed-text-v1.5/raw/main/README.md

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
      value: 75.20895522388058
    - type: ap
      value: 38.57605549557802
    - type: f1
      value: 69.35586565857854
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
      value: 91.8144
    - type: ap
      value: 88.65222882032363
    - type: f1
      value: 91.80426301643274
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
      value: 47.162000000000006
    - type: f1
      value: 46.59329642263158
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
      value: 24.253
    - type: map_at_10
      value: 38.962
    - type: map_at_100
      value: 40.081
    - type: map_at_1000
      value: 40.089000000000006
    - type: map_at_3
      value: 33.499
    - type: map_at_5
      value: 36.351
    - type: mrr_at_1
      value: 24.609
    - type: mrr_at_10
      value: 39.099000000000004
    - type: mrr_at_100
      value: 40.211000000000006
    - type: mrr_at_1000
      value: 40.219
    - type: mrr_at_3
      value: 33.677
    - type: mrr_at_5
      value: 36.469
    - type: ndcg_at_1
      value: 24.253
    - type: ndcg_at_10
      value: 48.010999999999996
    - type: ndcg_at_100
      value: 52.756
    - type: ndcg_at_1000
      value: 52.964999999999996
    - type: ndcg_at_3
      value: 36.564
    - type: ndcg_at_5
      value: 41.711999999999996
    - type: precision_at_1
      value: 24.253
    - type: precision_at_10
      value: 7.738
    - type: precision_at_100
      value: 0.98
    - type: precision_at_1000
      value: 0.1
    - type: precision_at_3
      value: 15.149000000000001
    - type: precision_at_5
      value: 11.593
    - type: recall_at_1
      value: 24.253
    - type: recall_at_10
      value: 77.383
    - type: recall_at_100
      value: 98.009
    - type: recall_at_1000
      value: 99.644
    - type: recall_at_3
      value: 45.448
    - type: recall_at_5
      value: 57.965999999999994
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
      value: 45.69069567851087
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
      value: 36.35185490976283
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
      value: 61.71274951450321
    - type: mrr
      value: 76.06032625423207
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
      value: 86.73980520022269
    - type: cos_sim_spearman
      value: 84.24649792685918
    - type: euclidean_pearson
      value: 85.85197641158186
    - type: euclidean_spearman
      value: 84.24649792685918
    - type: manhattan_pearson
      value: 86.26809552711346
    - type: manhattan_spearman
      value: 84.56397504030865
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
      value: 84.25324675324674
    - type: f1
      value: 84.17872280892557
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
      value: 38.770253446400886
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
      value: 32.94307095497281
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
      value: 32.164
    - type: map_at_10
      value: 42.641
    - type: map_at_100
      value: 43.947
    - type: map_at_1000
      value: 44.074999999999996
    - type: map_at_3
      value: 39.592
    - type: map_at_5
      value: 41.204
    - type: mrr_at_1
      value: 39.628
    - type: mrr_at_10
      value: 48.625
    - type: mrr_at_100
      value: 49.368
    - type: mrr_at_1000
      value: 49.413000000000004
    - type: mrr_at_3
      value: 46.400000000000006
    - type: mrr_at_5
      value: 47.68
   
```
