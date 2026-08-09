#!/usr/bin/env node
'use strict';

// Deterministically project the frozen 20-label fixture into the exploratory
// seven-label taxonomy. This script never reads model output or benchmark scores.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const sourcePath = path.join(ROOT, 'fixture', 'fixture_labelled.json');
const taxonomyPath = path.join(ROOT, 'taxonomy-reduced.json');
const outputPath = path.join(ROOT, 'fixture', 'fixture_reduced.json');

function projectRows(sourceRows, taxonomy) {
  const targetLabels = taxonomy.core.filter((label) => label.id !== 'unclassified');
  const mappedSourceLabels = new Set(targetLabels.flatMap((label) => label.source_labels || []));
  const excludedSourceLabels = new Set(taxonomy.excluded_source_labels || []);

  const allSourceLabels = new Set(sourceRows.flatMap((row) => row.labels));
  const undeclared = [...allSourceLabels].filter(
    (label) => !mappedSourceLabels.has(label) && !excludedSourceLabels.has(label)
  );
  if (undeclared.length) {
    throw new Error(`Reduced taxonomy does not map or exclude source labels: ${undeclared.join(', ')}`);
  }

  return sourceRows.map((row) => {
    const sourceLabels = [...row.labels];
    const labels = targetLabels
      .filter((target) => target.source_labels.some((source) => sourceLabels.includes(source)))
      .map((target) => target.id);

    return {
      ...row,
      labels: labels.length ? labels : ['unclassified'],
      source_labels_20: sourceLabels,
      reduced_taxonomy: taxonomy.variant_id,
      reduced_mapping: labels.length
        ? 'mapped from one or more in-scope source labels'
        : 'no in-scope source label; mapped to unclassified/outside reduced scope',
    };
  });
}

function main() {
  const sourceRows = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const taxonomy = JSON.parse(fs.readFileSync(taxonomyPath, 'utf8'));
  const rows = projectRows(sourceRows, taxonomy);
  fs.writeFileSync(outputPath, `${JSON.stringify(rows, null, 2)}\n`);
  console.log(`Wrote ${outputPath}: ${rows.length} rows`);
}

if (require.main === module) main();
module.exports = { projectRows };
