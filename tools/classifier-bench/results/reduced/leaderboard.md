# Reduced-category experiment — #137

> This is an exploratory, post-benchmark analysis. The reduced taxonomy was selected after the original 20-label results. It is not independent confirmation.

The run compares Potion 8M and BGE Micro on six broad displayed categories plus `unclassified`. It uses the same 208 public rows and the original candidate operating points. No threshold was calibrated on this fixture.

## Result

| Candidate | Macro-F1 (7 labels) | Micro-F1 | Coverage | Domain-cluster 95% CI | Separate-process deterministic |
|---|---:|---:|---:|---:|---|
| bge-micro-v2-labelsim-v2 | **0.440** | 0.462 | 74.0% | 0.374–0.542 | yes |
| potion-base-8M-labelsim-v2 | **0.395** | 0.485 | 98.6% | 0.237–0.436 | yes |

## Per-category F1

| Category | Gold rows | Gold domain groups | bge-micro-v2 | potion-base-8M |
|---|---:|---:|---:|---:|
| Communication & Social | 27 | 5 | 0.367 | 0.508 |
| Search, Reference & Education | 66 | 11 | 0.593 | 0.608 |
| News & Entertainment | 43 | 11 | 0.491 | 0.118 |
| Technology, Work & File Transfer | 66 | 8 | 0.426 | 0.505 |
| Shopping & Finance | 26 | 9 | 0.368 | 0.476 |
| Travel, Transport & Accommodation | 21 | 5 | 0.647 | 0.552 |
| Unclassified / Outside reduced scope | 10 | 8 | 0.188 | 0.000 |

## Interpretation

- The point estimates increased from the 20-label run, but the values are not directly comparable because the target changed.
- The reduced label text is the complete supervision for these label-similarity models. That text and the taxonomy were authored after the first benchmark.
- This run is arm64-only. It does not add a cross-architecture result; the original run found one BGE decision difference on amd64.
- Coverage counts `unclassified` as abstention, including a correct catch-all prediction. Read coverage with the `unclassified` F1 value.
- The `search_query` id is retained for the wider Search, Reference & Education label so the shared in-site-search validation rule remains applicable.
- `unclassified` includes rows outside the six displayed categories. It is a catch-all, not a content Finding.
- The classifier output remains a Candidate. It must not hide or remove a History row.

Machine-readable result: [`results.json`](results.json).
