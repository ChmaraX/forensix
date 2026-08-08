# Authoritative licence sources for michaelfeil/bge-small-en-v1.5


## README.md
Source: https://huggingface.co/michaelfeil/bge-small-en-v1.5/raw/main/README.md

```
---
tags:
- sentence-transformers
- feature-extraction
- sentence-similarity
- transformers
license: mit
language:
- en
---


<h1 align="center">Infinity Embedding Model</h1>

This is the stable default model for infinity.

```bash
pip install infinity_emb[all]
```

More details about the infinity inference project please refer to the Github: [Infinity](https://github.com/michaelfeil/infinity).


##  Usage for Embedding Model via infinity in Python

To deploy files with the [infinity_emb](https://github.com/michaelfeil/infinity) pip package.
Recommended is `device="cuda", engine="torch"` with flash attention on gpu, and `device="cpu", engine="optimum"` for onnx inference.


```python
import asyncio
from infinity_emb import AsyncEmbeddingEngine, EngineArgs

sentences = ["Embed this is sentence via Infinity.", "Paris is in France."]
engine = AsyncEmbeddingEngine.from_args(
    EngineArgs(
        model_name_or_path = "michaelfeil/bge-small-en-v1.5",
        device="cuda",
        # or device="cpu"
        engine="torch",
        # or engine="optimum"
        compile=True # enable torch.compile
))

async def main(): 
    async with engine:
        embeddings, usage = await engine.embed(sentences=sentences)
asyncio.run(main())
```

## CLI interface

The same args

```bash
pip install infinity_emb
infinity_emb --model-name-or-path michaelfeil/bge-small-en-v1.5 --port 7997
```


## Contact
If you have any question or suggestion related to this project, feel free to open an issue or pull request.
You also can email Michael Feil (infinity at michaelfeil.eu).


## Citation

If you find this repository useful, please consider giving a star :star: and citation

```
@software{Feil_Infinity_2023,
author = {Feil, Michael},
month = oct,
title = {{Infinity - To Embeddings and Beyond}},
url = {https://github.com/michaelfeil/infinity},
year = {2023}
}
```

## License
Infinity is licensed under the [MIT License](https://github.com/michaelfeil/infinity/blob/master/LICENSE).


```
