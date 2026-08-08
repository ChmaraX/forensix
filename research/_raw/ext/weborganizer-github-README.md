# <img src="website/assets/images/icon.png" style="height: 1em; vertical-align: -10%;"> Organize the Web: Constructing Domains Enhances Pre-Training Data Curation

[[Paper](https://arxiv.org/pdf/2502.10341.pdf)] [[Website](https://weborganizer.allen.ai)] [[Hugging Face](https://huggingface.co/WebOrganizer)]

<a href="https://weborganizer.allen.ai"><img src="website/assets/images/treemaps.png" width="75%" alt="Overview over WebOrganizer domains"></a>

*Interactively explore these domains and examples of web pages they contain at [https://weborganizer.allen.ai](https://weborganizer.allen.ai)*



## Resources

#### Domain Classifiers
All our domain classifiers are available on Huggingface Hub. Our default domain classifiers use both the URL and web site content to make predictions. We also provide two additional models that only use the web site content and therefore can be applied to a wider variety of documents.
1. __Topic__: [WebOrganizer/TopicClassifier](https://huggingface.co/WebOrganizer/TopicClassifier) ([-NoURL version](https://huggingface.co/WebOrganizer/TopicClassifier-NoURL))
2. __Format__: [WebOrganizer/FormatClassifier](https://huggingface.co/WebOrganizer/FormatClassifier) ([-NoURL version](https://huggingface.co/WebOrganizer/FormatClassifier-NoURL))

These domains classifiers are trained on the following datasets:
1. In a first stage, 1M web pages classifed by __Llama-3.1-8B__, available on HuggingFace Hub:
    * [WebOrganizer/TopicAnnotations-Llama-3.1-8B](https://huggingface.co/datasets/WebOrganizer/TopicAnnotations-Llama-3.1-8B)
    * [WebOrganizer/FormatAnnotations-Llama-3.1-8B](https://huggingface.co/datasets/WebOrganizer/FormatAnnotations-Llama-3.1-8B)
2. In a second stage, 100K pages classified by __Llama-3.1-405B-FP8__, available on HuggingFace Hub:
    * [WebOrganizer/TopicAnnotations-Llama-3.1-405B-FP8](https://huggingface.co/datasets/WebOrganizer/TopicAnnotations-Llama-3.1-405B-FP8)
    * [WebOrganizer/FormatAnnotations-Llama-3.1-405B-FP8](https://huggingface.co/datasets/WebOrganizer/FormatAnnotations-Llama-3.1-405B-FP8)

The __topic and format definitions__ and instructions for prompting large language models to classify documents are available in `define_domains/taxonomies`. The script for prompting models is `define_domains/prompt_classify.sh`. The 1M web pages were randomly sampled from DCLM RefinedWeb.


#### Corpus Annotations
We pre-process the `1b-1x` pool from DataComps-LM using [RefinedWeb filters](https://github.com/mlfoundations/dclm/blob/main/baselines/baselines_configs/dclm_baseline_refinedweb.yaml) and [BFF deduplication](https://github.com/mlfoundations/dclm/tree/main/dedup/bff).
The resulting 200B token corpus is available at, together with the annotations: [WebOrganizer/Corpus-200B](https://huggingface.co/datasets/WebOrganizer/Corpus-200B).

__Download the dataset by cloning the repository with Git LFS instead of HuggingFace's `load_dataset()`.__

The dataset has the following folder structure:
```bash
Corpus-200B/
    documents/  # Pre-processed web documents
        - CC_shard_00000000_processed.jsonl.zst
        - CC_shard_00000001_processed.jsonl.zst
        - ...
    tokens/  # number of tokens per document (GPT-NeoX tokenizer)
        - CC_shard_00000000_processed.npy
        - CC_shard_00000001_processed.npy
        - ...
    scores_dclm-fasttext/  # DCLM-fasttext score
        - CC_shard_00000000_processed.npy
        - ...
    scores_fineweb-edu/  # FineWeb-Edu score
        - CC_shard_00000000_processed.npy
        - ...
    scores_fineweb-edu__rounded/  # Rounded FineWeb-Edu score
        - CC_shard_00000000_processed__rounded.npy
        - ...
    domains_topics/  # TopicClassifier annotations
        - CC_shard_00000000_processed__choice.npy  # index of top choice
        - ...
    domain_topics__logits/
        - CC_shard_00000000_processed__logits.npy  # logits for each topic
        - ...
    domains_formats/  # FormatClassifier annotations
        - CC_shard_00000000_processed__choice.npy  # index of top choice
        - ...
      domains_formats/  # FormatClassifier annotations
        - CC_shard_00000000_processed__logits.npy  # logits for each format
        - ...
    domains_clusters-k24/  # K-means clusters
        - CC_shard_00000000_processed.npy  # cluster assignment for each document
        - ...
```
We also include statistics about the presence and co-occurence of domains in the `domain_statistics/` folder, computed with the `domain_statistics.py` script.

## Installation
Different steps in this repository require different dependencies:

*  __Data pre-processing__: *coming soon*
```bash
# install datatools and gte...
```

* __K-means clustering__: The code in `define_domains/k-means-clustering` is a fork of [facebookresearch/ssl-data-curation](https://github.com/facebookresearch/ssl-data-curation/tree/main). Please read the README in the this directory for installation instructions and to see our modifications.

* __DataComps-LM tokenization and training__: Please refer to the [DataComps-LM repository](https://github.com/mlfoundations/dclm) for instructions on how to tokenize and train models for DataComps-LM.


## Training New Domain Classifiers
You can define a new taxonomy config in `define_domains/taxonomies` and then train a new domain classifier using the `define_domains/prompt_classify.sh` script.
To distill the Llama annotations into a new domain classifier, use the `define_domains/train_classifier.sh` script and pass the new training dataset as a script option. For two stage training, simply run the training script twice with different training datasets, and initialize the second stage with the model checkpoint from the first stage.

## Annotating Data
The script `annotate_data/annotate.sh` does large-scale data annotation using a slurm job array to iterate through the document shards in the `Corpus-200B` folder, and annotate each document with quality and domain annotations, which are stored as numpy arrays in separate annotation folders.

## Predict a Training Distribution with RegMix
*Coming soon...*

## Selecting Training Data for Language Models
`select_training_data.py` uses the folder structure of the `Corpus-200B` and used by the annotation scripts to select training data for language models.

Example usage:
```python
python select_training_data.py \
    --input_base "datasets/Corpus-200B" \
    --output_base "datasets/selected/Baseline-30B" \
    --num_tokens 30000000000 \
    --do_sample \
    --num_proc 16
```

It supports various options for quality filtering and domain mixing and uses multiple workers to write data in parallel.
The script first writes indices for each document shard in the `Corpus-200B` folder and then uses multiple workers to write the data in parallel.
You can use the `domain_statistics.py` script to summarize the domain distribution of datasets and use these for selecting training data by passing them to `--ref_distribution <file>`.

The folder of selected documents can then be used with the tokenization and training scripts from the [DCLM repository](https://github.com/mlfoundations/dclm) to train a new language model.


## Citation
```bibtex
@article{wettig2025organize,
  title={Organize the Web: Constructing Domains Enhances Pre-Training Data Curation},
  author={Alexander Wettig and Kyle Lo and Sewon Min and Hannaneh Hajishirzi and Danqi Chen and Luca Soldaini},
  journal={arXiv preprint arXiv:2502.10341},
  year={2025}
}
```
