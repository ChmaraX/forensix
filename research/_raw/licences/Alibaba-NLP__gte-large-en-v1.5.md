# Authoritative licence sources for Alibaba-NLP/gte-large-en-v1.5


## README.md
Source: https://huggingface.co/Alibaba-NLP/gte-large-en-v1.5/raw/main/README.md

```
---
datasets:
- allenai/c4
library_name: transformers
tags:
- sentence-transformers
- gte
- mteb
- transformers.js
- sentence-similarity
license: apache-2.0
language:
- en
model-index:
- name: gte-large-en-v1.5
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
      value: 73.01492537313432
    - type: ap
      value: 35.05341696659522
    - type: f1
      value: 66.71270310883853
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
      value: 93.97189999999999
    - type: ap
      value: 90.5952493948908
    - type: f1
      value: 93.95848137716877
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
      value: 54.196
    - type: f1
      value: 53.80122334012787
  - task:
      type: Retrieval
    dataset:
      type: mteb/arguana
      name: MTEB ArguAna
      config: default
      split: test
      revision: c22ab2a51041ffd869aaddef7af8d8215647e41a
    metrics:
    - type: map_at_1
      value: 47.297
    - type: map_at_10
      value: 64.303
    - type: map_at_100
      value: 64.541
    - type: map_at_1000
      value: 64.541
    - type: map_at_3
      value: 60.728
    - type: map_at_5
      value: 63.114000000000004
    - type: mrr_at_1
      value: 48.435
    - type: mrr_at_10
      value: 64.657
    - type: mrr_at_100
      value: 64.901
    - type: mrr_at_1000
      value: 64.901
    - type: mrr_at_3
      value: 61.06
    - type: mrr_at_5
      value: 63.514
    - type: ndcg_at_1
      value: 47.297
    - type: ndcg_at_10
      value: 72.107
    - type: ndcg_at_100
      value: 72.963
    - type: ndcg_at_1000
      value: 72.963
    - type: ndcg_at_3
      value: 65.063
    - type: ndcg_at_5
      value: 69.352
    - type: precision_at_1
      value: 47.297
    - type: precision_at_10
      value: 9.623
    - type: precision_at_100
      value: 0.996
    - type: precision_at_1000
      value: 0.1
    - type: precision_at_3
      value: 25.865
    - type: precision_at_5
      value: 17.596
    - type: recall_at_1
      value: 47.297
    - type: recall_at_10
      value: 96.23
    - type: recall_at_100
      value: 99.644
    - type: recall_at_1000
      value: 99.644
    - type: recall_at_3
      value: 77.596
    - type: recall_at_5
      value: 87.98
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
      value: 48.467787861077475
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
      value: 43.39198391914257
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
      value: 63.12794820591384
    - type: mrr
      value: 75.9331442641692
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
      value: 87.85062993863319
    - type: cos_sim_spearman
      value: 85.39049989733459
    - type: euclidean_pearson
      value: 86.00222680278333
    - type: euclidean_spearman
      value: 85.45556162077396
    - type: manhattan_pearson
      value: 85.88769871785621
    - type: manhattan_spearman
      value: 85.11760211290839
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
      value: 87.32792207792208
    - type: f1
      value: 87.29132945999555
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
      value: 40.5779328301945
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
      value: 37.94425623865118
  - task:
      type: Retrieval
    dataset:
      type: mteb/cqadupstack-android
      name: MTEB CQADupstackAndroidRetrieval
      config: default
      split: test
      revision: f46a197baaae43b4f621051089b82a364682dfeb
    metrics:
    - type: map_at_1
      value: 32.978
    - type: map_at_10
      value: 44.45
    - type: map_at_100
      value: 46.19
    - type: map_at_1000
      value: 46.303
    - type: map_at_3
      value: 40.849000000000004
    - type: map_at_5
      value: 42.55
    - type: mrr_at_1
      value: 40.629
    - type: mrr_at_10
      value: 50.848000000000006
    - type: mrr_at_100
      value: 51.669
    - type: mrr_at_1000
      value: 51.705
    - type: mrr_at_3
      value: 47.997
    - type: mrr_at_5
      value: 49.506
    - type
```
