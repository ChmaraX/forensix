// Throwaway Source driver for issue #148 (Windows legacy DPAPI / OSCrypt v10 ground truth).
// Not part of v2. Runs AS THE SUSPECT USER. Launches a real Chrome, writes known-plaintext
// cookies via CDP (no network at all), then quits gracefully so rows are flushed to disk.
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const [, , execPath, userDataDir, outDir] = process.argv;

// Known plaintext. Mirrors research/_raw/149-cookie-writer.py so results are comparable.
const COOKIES = [
  { name: 'fx_ascii', value: 'ForensiX-known-plaintext-ASCII-0001' },
  { name: 'fx_nonascii', value: 'ForensiX-\u00c1\u00c9\u00cd\u00d3\u00da-\u00e1\u00e9\u00ed-\u0159\u0161\u010d-\u65e5\u672c\u8a9e-\ud83d\udd10' },
  { name: 'fx_block16', value: 'AAAABBBBCCCCDDDD' }, // exactly one AES block
  { name: 'fx_long', value: 'L'.repeat(200) },
  { name: 'fx_one', value: 'X' },
];

const HOST = 'http://forensix.invalid/';

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: execPath,
    userDataDir,
    headless: 'new',
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-dev-shm-usage',
      '--disable-background-networking',
      '--no-service-autorun',
    ],
  });
  const version = await browser.version();
  fs.writeFileSync(path.join(outDir, 'chrome_version.txt'), version + '\n');

  const page = await browser.newPage();
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;
  for (const c of COOKIES) {
    await page.setCookie({
      url: HOST,
      name: c.name,
      value: c.value,
      domain: 'forensix.invalid',
      path: '/',
      expires: expiresAt,
      httpOnly: false,
      secure: false,
    });
  }
  fs.writeFileSync(
    path.join(outDir, 'known_plaintext.json'),
    JSON.stringify({ host: HOST, cookies: COOKIES }, null, 2)
  );

  // Force a cookie-store flush, then shut down cleanly.
  const readBack = await page.cookies(HOST);
  fs.writeFileSync(path.join(outDir, 'cookies_readback.json'), JSON.stringify(readBack, null, 2));
  await new Promise((r) => setTimeout(r, 1500));
  await browser.close();
  await new Promise((r) => setTimeout(r, 2500));
  fs.writeFileSync(path.join(outDir, 'driver_done.txt'), 'ok\n');
})().catch((e) => {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'driver_error.txt'), String(e && e.stack || e) + '\n');
  process.exit(1);
});
