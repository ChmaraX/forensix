# Issue #119: URL classifier replacement options

## Question

What are the modern options for classifying browsing-history URLs into categories, replacing v1's 700MB scikit-learn pickle?

Survey: small local models (ONNX/transformers), embedding + nearest-centroid, LLM API calls, curated domain-category lists, hybrids.

For each: model size, offline capability, licence, accuracy expectations, and whether it forces a Python runtime into the stack.

Context: the pickle is *why* scikit-learn 1.2.2 / numpy 1.24.3 are pinned — "latest deps" and "keep the model" are mutually exclusive. Unpickling is also arbitrary code execution.

