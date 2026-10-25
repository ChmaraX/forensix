# Export and report

An **Extract** is a deterministic, hashed copy of selected records from the Case. A **Report** is one self-contained HTML file made only from an Extract. Neither changes the Case.

## Steps

1. **Agree the scope with the user.** Which Profiles, which collections (`findings`, `candidates`), saved rows only (`--commit-state committed`) or all rows, and the examiner name.

2. **Export** to a new, empty directory outside the Case. Use an absolute path:

   ```bash
   forensix export --case "<case>" --out "/abs/path/EXTRACT-001" \
     --examiner "<name>" [--profile <p>]... [--collection findings|candidates]... \
     [--commit-state committed] [--csv] --json
   ```

   - Secrets are redacted by default. Add `--include-secrets` only when the user explicitly asks to disclose them, and say so in your answer.
   - `--csv` adds lossy CSV copies. The JSONL files stay the record of truth.

3. **Render the Report:**

   ```bash
   forensix report --extract "/abs/path/EXTRACT-001" --out "/abs/path/report.html" --json
   ```

4. **Check integrity.** The `integrity` key in the `report` result states whether the Extract is `verified` or `altered`. If it is `altered`, do not give the Report as evidence. Tell the user that the Extract changed after export.

Done when the user has the Extract path, the Export Manifest derived digest from `export_manifest.json`, the Report path, and the integrity result.
