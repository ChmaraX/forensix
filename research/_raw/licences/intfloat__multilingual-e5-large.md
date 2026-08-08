# Authoritative licence sources for intfloat/multilingual-e5-large


## README.md
Source: https://huggingface.co/intfloat/multilingual-e5-large/raw/main/README.md

```
---
tags:
- mteb
- Sentence Transformers
- sentence-similarity
- feature-extraction
- sentence-transformers
model-index:
- name: multilingual-e5-large
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
      value: 79.05970149253731
    - type: ap
      value: 43.486574390835635
    - type: f1
      value: 73.32700092140148
  - task:
      type: Classification
    dataset:
      type: mteb/amazon_counterfactual
      name: MTEB AmazonCounterfactualClassification (de)
      config: de
      split: test
      revision: e8379541af4e31359cca9fbcf4b00f2671dba205
    metrics:
    - type: accuracy
      value: 71.22055674518201
    - type: ap
      value: 81.55756710830498
    - type: f1
      value: 69.28271787752661
  - task:
      type: Classification
    dataset:
      type: mteb/amazon_counterfactual
      name: MTEB AmazonCounterfactualClassification (en-ext)
      config: en-ext
      split: test
      revision: e8379541af4e31359cca9fbcf4b00f2671dba205
    metrics:
    - type: accuracy
      value: 80.41979010494754
    - type: ap
      value: 29.34879922376344
    - type: f1
      value: 67.62475449011278
  - task:
      type: Classification
    dataset:
      type: mteb/amazon_counterfactual
      name: MTEB AmazonCounterfactualClassification (ja)
      config: ja
      split: test
      revision: e8379541af4e31359cca9fbcf4b00f2671dba205
    metrics:
    - type: accuracy
      value: 77.8372591006424
    - type: ap
      value: 26.557560591210738
    - type: f1
      value: 64.96619417368707
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
      value: 93.489875
    - type: ap
      value: 90.98758636917603
    - type: f1
      value: 93.48554819717332
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
      value: 47.564
    - type: f1
      value: 46.75122173518047
  - task:
      type: Classification
    dataset:
      type: mteb/amazon_reviews_multi
      name: MTEB AmazonReviewsClassification (de)
      config: de
      split: test
      revision: 1399c76144fd37290681b995c656ef9b2e06e26d
    metrics:
    - type: accuracy
      value: 45.400000000000006
    - type: f1
      value: 44.17195682400632
  - task:
      type: Classification
    dataset:
      type: mteb/amazon_reviews_multi
      name: MTEB AmazonReviewsClassification (es)
      config: es
      split: test
      revision: 1399c76144fd37290681b995c656ef9b2e06e26d
    metrics:
    - type: accuracy
      value: 43.068
    - type: f1
      value: 42.38155696855596
  - task:
      type: Classification
    dataset:
      type: mteb/amazon_reviews_multi
      name: MTEB AmazonReviewsClassification (fr)
      config: fr
      split: test
      revision: 1399c76144fd37290681b995c656ef9b2e06e26d
    metrics:
    - type: accuracy
      value: 41.89
    - type: f1
      value: 40.84407321682663
  - task:
      type: Classification
    dataset:
      type: mteb/amazon_reviews_multi
      name: MTEB AmazonReviewsClassification (ja)
      config: ja
      split: test
      revision: 1399c76144fd37290681b995c656ef9b2e06e26d
    metrics:
    - type: accuracy
      value: 40.120000000000005
    - type: f1
      value: 39.522976223819114
  - task:
      type: Classification
    dataset:
      type: mteb/amazon_reviews_multi
      name: MTEB AmazonReviewsClassification (zh)
      config: zh
      split: test
      revision: 1399c76144fd37290681b995c656ef9b2e06e26d
    metrics:
    - type: accuracy
      value: 38.832
    - type: f1
      value: 38.0392533394713
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
      value: 30.725
    - type: map_at_10
      value: 46.055
    - type: map_at_100
      value: 46.900999999999996
    - type: map_at_1000
      value: 46.911
    - type: map_at_3
      value: 41.548
    - type: map_at_5
      value: 44.297
    - type: mrr_at_1
      value: 31.152
    - type: mrr_at_10
      value: 46.231
    - type: mrr_at_100
      value: 47.07
    - type: mrr_at_1000
      value: 47.08
    - type: mrr_at_3
      value: 41.738
    - type: mrr_at_5
      value: 44.468999999999994
    - type: ndcg_at_1
      value: 30.725
    - type: ndcg_at_10
      value: 54.379999999999995
    - type: ndcg_at_100
      value: 58.138
    - type: ndcg_at_1000
      value: 58.389
    - type: ndcg_at_3
      value: 45.156
    - type: ndcg_at_5
      value: 50.123
    - type: precision_at_1
      value: 30.725
    - type: precision_at_10
      value: 8.087
    - type: precision_at_100
      value: 0.9769999999999999
    - type: precision_at_1000
      value: 0.1
    - type: precision_at_3
      value: 18.54
    - type: precision_at_5
      value: 13.542000000000002
    - type: recall_at_1
      value: 30.725
    - type: recall_at_10
      value: 80.868
    - type: recall_at_100
      value: 97.653
    - type: recall_at_1000
      value: 99.57300000000001
    - type: recall_at_3
      value: 55.619
    - type: recall_at_5
      value: 67.71000000000001
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
      value: 44.30960650674069
  - task:
      type: Cluster
```
