// Throwaway acquisition driver for issue #135 (Windows/Linux Chrome characterization).
// Not part of v2. Drives a real Chrome-for-Testing session against public sites only
// (no case data), populates history + cache + a cookie, then quits gracefully.
const puppeteer = require('puppeteer-core');

const [, , execPath, userDataDir] = process.argv;

const urls = [
  'https://example.com/',
  'https://www.iana.org/',
  'https://httpbin.org/html',
  'https://httpbin.org/image/png',
  'https://httpbin.org/image/jpeg',
  'https://httpbin.org/image/webp',
  'https://httpbin.org/json',
  'https://httpbin.org/xml',
  'https://httpbin.org/robots.txt',
  'https://httpbin.org/cookies/set/forensix_probe/abc123',
  'https://developer.mozilla.org/en-US/',
  'https://en.wikipedia.org/wiki/Special:Random',
  'https://en.wikipedia.org/wiki/Special:Random',
  'https://en.wikipedia.org/wiki/Special:Random',
  'https://news.ycombinator.com/',
];

(async () => {
  const browser = await puppeteer.launch({
    executablePath: execPath,
    userDataDir,
    headless: 'new',
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
  });
  const page = await browser.newPage();
  for (const u of urls) {
    try {
      await page.goto(u, { waitUntil: 'networkidle2', timeout: 20000 });
      await new Promise((r) => setTimeout(r, 250));
    } catch (e) {
      console.error('nav failed', u, e.message);
    }
  }
  await new Promise((r) => setTimeout(r, 1000));
  await browser.close();
  // give the browser process a moment to fully release file locks / flush WAL
  await new Promise((r) => setTimeout(r, 1500));
})();
