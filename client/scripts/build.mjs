/**
 * Client release build: one self-contained index.js.
 *
 *   node scripts/build.mjs [--outdir <dir>]
 *
 * Writes `client/dist/index.js` unless `--outdir` or FORENSIX_CLIENT_OUTDIR
 * names another directory (for parallel builds that must not share dist/).
 */
import { buildClient, resolveOutDir } from "./bundle.mjs";

const flag = process.argv.indexOf("--outdir");
const outDir = flag === -1 ? undefined : process.argv[flag + 1];
if (flag !== -1 && (outDir === undefined || outDir.startsWith("--"))) {
  console.error("[forensix build] --outdir needs a directory.");
  process.exit(1);
}

await buildClient({ outDir: resolveOutDir(outDir) });
