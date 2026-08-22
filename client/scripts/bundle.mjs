/**
 * The client bundle step, shared by the release build and the dev watcher.
 *
 * The dashboard server serves exactly one static file (dist/index.js, read as
 * text) under a CSP with no font/img/style sources, so the bundle must carry
 * everything: the compiled CSS is injected from JS as a <style> element
 * (allowed by style-src 'unsafe-inline'), fonts stay on the system stack, and
 * icons are inline SVG.
 *
 * The dev variant differs only in what a local examiner needs: readable output,
 * an inline source map, and a reload probe. It is never used by `build`.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const clientRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

function tailwindBinPath() {
  const packagePath = require.resolve("@tailwindcss/cli/package.json");
  const manifest = JSON.parse(readFileSync(packagePath, "utf8"));
  const bin =
    typeof manifest.bin === "string"
      ? manifest.bin
      : manifest.bin[Object.keys(manifest.bin)[0]];
  return join(dirname(packagePath), bin);
}

function compileCss({ minify }) {
  const cssOut = join(clientRoot, "dist", "app.generated.css");
  const argv = [
    tailwindBinPath(),
    "--input",
    join(clientRoot, "src", "app.css"),
    "--output",
    cssOut,
  ];
  if (minify) {
    argv.push("--minify");
  }
  const tailwind = spawnSync(process.execPath, argv, {
    cwd: clientRoot,
    stdio: minify ? "inherit" : "ignore",
  });
  if (tailwind.status !== 0) {
    throw new Error("Tailwind CSS compilation failed.");
  }
  const css = readFileSync(cssOut, "utf8");
  rmSync(cssOut);
  return css;
}

/**
 * Dev-only reload probe.
 *
 * The server reads the bundle once at start-up, so a rebuilt bundle only
 * reaches the browser after the dev watcher restarts it. The page therefore
 * polls the one script it is already allowed to request (`connect-src 'self'`)
 * and reloads when the stamp it was built with is gone. The page is reloaded,
 * not patched: this surface holds evidence, and a half-swapped module could
 * show rows that no longer match the Case.
 */
function reloadProbe(stamp) {
  return `
(() => {
  const stamp = ${JSON.stringify(stamp)};
  let missed = 0;
  setInterval(() => {
    fetch("/index.js", { cache: "no-store" })
      .then((response) => response.text())
      .then((text) => {
        if (!text.includes(stamp)) {
          globalThis.location.reload();
        }
        missed = 0;
      })
      .catch(() => {
        // The watcher restarts the server between builds; only a sustained
        // outage is worth reporting.
        missed += 1;
        if (missed === 20) {
          console.warn("[forensix dev] the dashboard server is not answering.");
        }
      });
  }, 1000);
})();
`;
}

/** Writes `dist/index.js`. Returns the build stamp used for the dev probe. */
export async function buildClient({ dev = false } = {}) {
  mkdirSync(join(clientRoot, "dist"), { recursive: true });
  const css = compileCss({ minify: !dev });
  const stamp = `fx-dev-${String(Date.now())}-${Math.random().toString(36).slice(2, 10)}`;

  await build({
    entryPoints: [join(clientRoot, "src", "main.tsx")],
    bundle: true,
    format: "iife",
    outfile: join(clientRoot, "dist", "index.js"),
    minify: !dev,
    sourcemap: dev ? "inline" : false,
    target: ["es2022"],
    jsx: "automatic",
    legalComments: "none",
    logLevel: dev ? "silent" : "info",
    banner: {
      js: "// @forensix/client read-only Case dashboard bundle (CLIENT_IMPLEMENTATION_ISSUE 171)",
    },
    footer: dev ? { js: reloadProbe(stamp) } : {},
    // Images are inlined as data URIs rather than emitted beside the bundle:
    // the server serves exactly one static file, and the surface must keep
    // working with no second request to make.
    loader: { ".png": "dataurl" },
    define: {
      "process.env.NODE_ENV": dev ? '"development"' : '"production"',
      __APP_CSS__: JSON.stringify(css),
    },
  });

  return stamp;
}
