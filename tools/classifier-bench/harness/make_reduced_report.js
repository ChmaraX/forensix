'use strict';
// Generate the human-readable reduced-category report from results.json.

const fs = require('node:fs');
const path = require('node:path');

const resultsDir = process.argv[2] || path.join(__dirname, '..', 'results', 'reduced');
const results = JSON.parse(fs.readFileSync(path.join(resultsDir, 'results.json'), 'utf8'));
const determinismPath = path.join(resultsDir, 'determinism-summary.json');
const determinism = fs.existsSync(determinismPath)
  ? JSON.parse(fs.readFileSync(determinismPath, 'utf8'))
  : null;
const pct = (value) => value == null ? 'unmeasured' : `${(value * 100).toFixed(1)}%`;
const f3 = (value) => value == null ? 'unmeasured' : value.toFixed(3);
const rankedCandidates = [...results.candidates]
  .sort((a, b) => b.macro_f1_fixed_core.value - a.macro_f1_fixed_core.value);

const lines = [];
lines.push('# Reduced-category experiment — #137');
lines.push('');
lines.push('> This is an exploratory, post-benchmark analysis. The reduced taxonomy was selected after the original 20-label results. It is not independent confirmation.');
lines.push('');
lines.push('The run compares Potion 8M and BGE Micro on six broad displayed categories plus `unclassified`. It uses the same 208 public rows and the original candidate operating points. No threshold was calibrated on this fixture.');
lines.push('');
lines.push('## Result');
lines.push('');
lines.push('| Candidate | Macro-F1 (7 labels) | Micro-F1 | Coverage | Domain-cluster 95% CI | Separate-process deterministic |');
lines.push('|---|---:|---:|---:|---:|---|');
for (const candidate of rankedCandidates) {
  const det = determinism?.per_candidate?.[candidate.id];
  lines.push(`| ${candidate.id} | **${f3(candidate.macro_f1_fixed_core.value)}** | ${f3(candidate.micro_f1)} | ${pct(candidate.coverage)} | ${f3(candidate.bootstrap_ci.ci95_low)}–${f3(candidate.bootstrap_ci.ci95_high)} | ${det?.measured ? (det.match && det.raw_score_match ? 'yes' : 'no') : 'unmeasured'} |`);
}
lines.push('');
lines.push('## Per-category F1');
lines.push('');
lines.push('| Category | Gold rows | Gold domain groups | ' + rankedCandidates.map((c) => c.id.replace('-labelsim-v2', '')).join(' | ') + ' |');
lines.push('|---|---:|---:|' + rankedCandidates.map(() => '---:').join('|') + '|');
for (const label of results.taxonomy.labels) {
  const first = rankedCandidates[0].per_class[label.id];
  lines.push(`| ${label.name} | ${first.goldPositives} | ${first.gold_domain_support} | ${rankedCandidates.map((c) => f3(c.per_class[label.id].f1)).join(' | ')} |`);
}
lines.push('');
lines.push('## Interpretation');
lines.push('');
lines.push('- The point estimates increased from the 20-label run, but the values are not directly comparable because the target changed.');
lines.push('- The reduced label text is the complete supervision for these label-similarity models. That text and the taxonomy were authored after the first benchmark.');
lines.push('- This run is arm64-only. It does not add a cross-architecture result; the original run found one BGE decision difference on amd64.');
lines.push('- Coverage counts `unclassified` as abstention, including a correct catch-all prediction. Read coverage with the `unclassified` F1 value.');
lines.push('- The `search_query` id is retained for the wider Search, Reference & Education label so the shared in-site-search validation rule remains applicable.');
lines.push('- `unclassified` includes rows outside the six displayed categories. It is a catch-all, not a content Finding.');
lines.push('- The classifier output remains a Candidate. It must not hide or remove a History row.');
lines.push('');
lines.push('Machine-readable result: [`results.json`](results.json).');

fs.writeFileSync(path.join(resultsDir, 'leaderboard.md'), `${lines.join('\n')}\n`);
console.log(`Wrote ${path.join(resultsDir, 'leaderboard.md')}`);
