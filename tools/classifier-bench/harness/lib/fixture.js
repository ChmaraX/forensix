'use strict';
// Shared, byte-identical input normalisation for every candidate (#137 §2 requirement).
const fs = require('node:fs');
const path = require('node:path');

function loadFixture(fixtureDir) {
  const rows = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'fixture_labelled.json'), 'utf8'));
  return rows;
}

function loadTaxonomy(rootDir) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, 'taxonomy.json'), 'utf8'));
}

// The one normalisation every candidate sees identically: title + " " + url,
// per #136's recommended input contract (title+URL, nothing else).
function normalisedInput(row) {
  const title = (row.title || '').trim();
  const url = (row.url || '').trim();
  return `${title} ${url}`.trim();
}

module.exports = { loadFixture, loadTaxonomy, normalisedInput };
