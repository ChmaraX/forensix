# Authoritative licence sources for intfloat/multilingual-e5-large-instruct


## README.md
Source: https://huggingface.co/intfloat/multilingual-e5-large-instruct/raw/main/README.md

```
---
tags:
- mteb
- sentence-transformers
- transformers
model-index:
- name: multilingual-e5-large-instruct
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
      value: 76.23880597014924
    - type: ap
      value: 39.07351965022687
    - type: f1
      value: 70.04836733862683
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
      value: 66.71306209850107
    - type: ap
      value: 79.01499914759529
    - type: f1
      value: 64.81951817560703
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
      value: 73.85307346326837
    - type: ap
      value: 22.447519885878737
    - type: f1
      value: 61.0162730745633
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
      value: 76.04925053533191
    - type: ap
      value: 23.44983217128922
    - type: f1
      value: 62.5723230907759
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
      value: 96.28742500000001
    - type: ap
      value: 94.8449918887462
    - type: f1
      value: 96.28680923610432
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
      value: 56.716
    - type: f1
      value: 55.76510398266401
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
      value: 52.99999999999999
    - type: f1
      value: 52.00829994765178
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
      value: 48.806000000000004
    - type: f1
      value: 48.082345914983634
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
      value: 48.507999999999996
    - type: f1
      value: 47.68752844642045
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
      value: 47.709999999999994
    - type: f1
      value: 47.05870376637181
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
      value: 44.662000000000006
    - type: f1
      value: 43.42371965372771
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
      value: 31.721
    - type: map_at_10
      value: 49.221
    - type: map_at_100
      value: 49.884
    - type: map_at_1000
      value: 49.888
    - type: map_at_3
      value: 44.31
    - type: map_at_5
      value: 47.276
    - type: mrr_at_1
      value: 32.432
    - type: mrr_at_10
      value: 49.5
    - type: mrr_at_100
      value: 50.163000000000004
    - type: mrr_at_1000
      value: 50.166
    - type: mrr_at_3
      value: 44.618
    - type: mrr_at_5
      value: 47.541
    - type: ndcg_at_1
      value: 31.721
    - type: ndcg_at_10
      value: 58.384
    - type: ndcg_at_100
      value: 61.111000000000004
    - type: ndcg_at_1000
      value: 61.187999999999995
    - type: ndcg_at_3
      value: 48.386
    - type: ndcg_at_5
      value: 53.708999999999996
    - type: precision_at_1
      value: 31.721
    - type: precision_at_10
      value: 8.741
    - type: precision_at_100
      value: 0.991
    - type: precision_at_1000
      value: 0.1
    - type: precision_at_3
      value: 20.057
    - type: precision_at_5
      value: 14.609
    - type: recall_at_1
      value: 31.721
    - type: recall_at_10
      value: 87.411
    - type: recall_at_100
      value: 99.075
    - type: recall_at_1000
      value: 99.644
    - type: recall_at_3
      value: 60.171
    - type: recall_at_5
      value: 73.044
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
      value: 46.40419580759799
  - task:
      type: Clustering
    dataset:
      type: mteb/ar
```
