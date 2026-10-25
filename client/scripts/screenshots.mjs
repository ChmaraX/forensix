/**
 * Regenerates the README screenshots (docs/media/overview.png and
 * docs/media/sites.png) from the design mock Case.
 *
 *   cd client && npm run build && npm run screenshots
 *
 * Starts the mock server on a free port, opens each view in headless
 * Chromium at 1440x900 (device scale 2, light theme), and writes the PNGs.
 * Uses the repository's Playwright dev dependency.
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const clientRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const media = join(clientRoot, "..", "docs", "media");
const port = 7890 + Math.floor(Math.random() * 100);

const SHOTS = [
  { file: "overview.png", hash: "#/overview" },
  // A host whose every row the subject cleared: shown only as recovered.
  { file: "sites.png", hash: "#/sites?host=wetransfer.com" },
];

const server = spawn(
  process.execPath,
  [join(clientRoot, "mock", "server.mjs"), "--port", String(port)],
  { stdio: ["ignore", "pipe", "inherit"] },
);
await new Promise((resolve, reject) => {
  server.stdout.on("data", (chunk) => {
    if (String(chunk).includes("ready")) resolve();
  });
  server.once("exit", (code) =>
    reject(new Error(`mock server exited with code ${String(code)}`)),
  );
});

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: "light",
  });
  for (const shot of SHOTS) {
    await page.goto(`http://127.0.0.1:${String(port)}/${shot.hash}`);
    await page.waitForLoadState("networkidle");
    // Charts and favicons settle after the data arrives.
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(media, shot.file) });
    console.log(`wrote docs/media/${shot.file}`);
  }
} finally {
  await browser.close();
  server.kill();
}
