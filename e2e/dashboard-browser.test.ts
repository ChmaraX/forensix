/**
 * Browser E2E of the read-only dashboard: the compiled `forensix serve` on a
 * fixture Case (`e2e/lib/dashboard-case.ts`), driven in headless Chromium
 * through accessible roles, names and text only.
 *
 * Artifacts: every case keeps a Playwright trace (`<case>.zip`, open with
 * `pnpm exec playwright show-trace <file>`) and a final screenshot
 * (`<case>.png`) under `e2e/.artifacts/dashboard/` (or
 * `$FORENSIX_E2E_ARTIFACTS`), next to the fixture Case itself (`case/`;
 * reopen it with `node cli/dist/cli.js serve --case <dir>`). The directory is
 * cleared at the start of each run and printed.
 *
 * Known gaps: a case for a finding not fixed yet runs its check through
 * `knownGap(id, …)`. While the id is in `EXPECTED_TO_FAIL` the check must
 * fail (the case passes and logs "still failing"); once it passes the case
 * fails and asks for the id to be removed, which turns the check into a
 * plain assertion. Everything before the check (the scenario's set-up) is
 * always asserted.
 *
 * Needs Chromium (`pnpm exec playwright install chromium`). Without it the
 * suite is skipped with a message, unless `FORENSIX_REQUIRE_BROWSER_E2E=1`
 * (set in CI), which turns the missing browser into a failure.
 */
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { rowRefOf, type RowRefSource } from "../client/src/router.js";
import {
  buildDashboardCase,
  COOKIE,
  DOWNLOAD_FILE_NAME,
  DOWNLOAD_ONLY_HOST,
  HISTORY_DAYS,
  LOGINS,
  OLDEST_VISIT_URL,
  readApi,
  RECOVERED_TARGET_TITLE,
  RECOVERED_TARGET_URL,
  startDashboard,
  type Dashboard,
} from "./lib/dashboard-case.js";

/** Review findings whose fix has not landed: their checks must still fail.
 *  S1 the Sites page lists only hosts the client derives itself (the core
 *  `site-hosts` route already lists a download-only host), F3 the Timeline
 *  does not look up a linked row it has not loaded. (F1, the topic line's
 *  invented reason, and F2, a reveal carried to the next row, are fixed.) */
const EXPECTED_TO_FAIL: ReadonlySet<string> = new Set(["S1", "F3"]);

const ARTIFACTS = resolve(
  process.env.FORENSIX_E2E_ARTIFACTS ?? "e2e/.artifacts/dashboard",
);
const REQUIRE_BROWSER = process.env.FORENSIX_REQUIRE_BROWSER_E2E === "1";
/** Why headless Chromium cannot start here, or null when it can. */
const LAUNCH_PROBLEM: string | null = await chromium.launch().then(
  async (probe) => {
    await probe.close();
    return null;
  },
  (error: unknown) =>
    (error instanceof Error ? error.message : String(error)).split("\n")[0] ??
    "launch failed",
);
const CHROMIUM_AVAILABLE = LAUNCH_PROBLEM === null;

if (!CHROMIUM_AVAILABLE) {
  const message = `Dashboard browser E2E: Chromium is not available (${LAUNCH_PROBLEM}). Run \`pnpm exec playwright install chromium\`.`;
  if (REQUIRE_BROWSER) {
    throw new Error(`${message} FORENSIX_REQUIRE_BROWSER_E2E=1 requires it.`);
  }
  console.warn(`${message} Skipping.`);
}

/** The case title, marked while its finding is still expected to fail. */
function titled(title: string, finding?: string): string {
  return finding !== undefined && EXPECTED_TO_FAIL.has(finding)
    ? `${title} [expected-fail ${finding}]`
    : title;
}

/** Runs the check a finding's fix makes pass (see the file comment). */
async function knownGap(
  finding: string,
  description: string,
  check: () => Promise<void>,
): Promise<void> {
  if (!EXPECTED_TO_FAIL.has(finding)) {
    await check();
    return;
  }
  try {
    await check();
  } catch (error) {
    const reason = (error instanceof Error ? error.message : String(error))
      .split("\n")[0]
      ?.slice(0, 200);
    console.info(
      `[expected-fail ${finding}] ${description}: still failing (${reason ?? ""})`,
    );
    return;
  }
  throw new Error(
    `[expected-fail ${finding}] ${description} now passes: remove "${finding}" from EXPECTED_TO_FAIL in e2e/dashboard-browser.test.ts.`,
  );
}

/** How long a known-gap check waits before it counts as failing. */
const GAP_TIMEOUT = 4_000;

interface Row extends RowRefSource {
  readonly findingKind: string;
  readonly fields: Readonly<
    Record<string, { readonly state: string; readonly value?: unknown }>
  >;
}

interface RowPage {
  readonly items: readonly Row[];
  readonly nextCursor: string | null;
}

function refOf(row: Row | undefined): string {
  const ref = row === undefined ? null : rowRefOf(row);
  if (ref === null) {
    throw new Error("The fixture row has no row reference.");
  }
  return ref;
}

const urlOf = (row: Row) => row.fields.url?.value;

/** The hash for a page with a row (and optional extras) open. */
function deepLink(
  page: string,
  parameters: Readonly<Record<string, string>>,
): string {
  return `#/${page}?${new URLSearchParams(parameters).toString()}`;
}

/** The row reference named in the page's current URL. */
function openRowOf(page: Page): string | null {
  const hash = new URL(page.url()).hash;
  const query = hash.indexOf("?");
  return query === -1
    ? null
    : new URLSearchParams(hash.slice(query + 1)).get("row");
}

function rangeOf(page: Page): readonly [string | null, string | null] {
  const hash = new URL(page.url()).hash;
  const query = new URLSearchParams(hash.slice(hash.indexOf("?") + 1));
  return [query.get("from"), query.get("to")];
}

/** The open row sheet (a modal dialog titled by the row). */
function sheet(page: Page, title: string | RegExp): Locator {
  return page.getByRole("dialog", { name: title });
}

async function visible(locator: Locator, timeout?: number): Promise<void> {
  await locator.first().waitFor({ state: "visible", timeout });
}

/** ⌘K (Ctrl+K off macOS): open Jump to, search, wait for `option`.
 *  A Jump to still closing is waited out first: reopened while its exit
 *  overlaps a row sheet opening, the menu's input is left aria-hidden
 *  (reported to the lead as a client bug, outside this suite's findings). */
async function jumpTo(page: Page, query: string, option: RegExp) {
  await page
    .locator('[role="dialog"]')
    .filter({ hasText: "Search pages, hosts" })
    .waitFor({ state: "detached" });
  await page.keyboard.press("ControlOrMeta+k");
  const menu = page.getByRole("dialog", { name: "Jump to" });
  await menu.getByRole("combobox", { name: "Jump to" }).fill(query);
  const match = menu.getByRole("option", { name: option });
  await visible(match);
  return { menu, match };
}

describe.skipIf(!CHROMIUM_AVAILABLE)(
  "dashboard in a browser",
  { timeout: 60_000 },
  () => {
    let dashboard: Dashboard;
    let browser: Browser;
    let context: BrowserContext;
    let page: Page;
    let caseName = "";
    let rowsByUrl: ReadonlyMap<unknown, Row>;

    beforeAll(async () => {
      await rm(ARTIFACTS, { recursive: true, force: true });
      await mkdir(ARTIFACTS, { recursive: true });
      console.info(`Dashboard browser E2E artifacts: ${ARTIFACTS}`);
      const caseDirectory = await buildDashboardCase(ARTIFACTS);
      dashboard = await startDashboard(caseDirectory);
      browser = await chromium.launch();
      // Every History row the scenarios address, saved and recovered.
      const rows: Row[] = [];
      for (const commitState of ["committed", "wal_resident"]) {
        let after: string | null = null;
        do {
          const result: RowPage = await readApi<RowPage>(dashboard, "history", {
            "commit-state": commitState,
            limit: "100",
            ...(after === null ? {} : { after }),
          });
          rows.push(...result.items);
          after = result.nextCursor;
        } while (after !== null);
      }
      rowsByUrl = new Map(
        rows.map((row) => [`${row.commitState} ${String(urlOf(row))}`, row]),
      );
    }, 180_000);

    afterAll(async () => {
      await browser?.close();
      dashboard?.stop();
      console.info(`Dashboard browser E2E artifacts kept in ${ARTIFACTS}`);
    });

    async function open(name: string, hash = ""): Promise<Page> {
      caseName = name;
      context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        timezoneId: "UTC",
      });
      context.setDefaultTimeout(10_000);
      await context.tracing.start({ screenshots: true, snapshots: true });
      page = await context.newPage();
      await page.goto(`${dashboard.url}${hash}`);
      return page;
    }

    afterEach(async () => {
      if (caseName === "") {
        return;
      }
      await page
        .screenshot({
          path: join(ARTIFACTS, `${caseName}.png`),
          fullPage: true,
        })
        .catch(() => undefined);
      await context.tracing.stop({ path: join(ARTIFACTS, `${caseName}.zip`) });
      await context.close();
      caseName = "";
    });

    const row = (commitState: string, url: string): Row => {
      const found = rowsByUrl.get(`${commitState} ${url}`);
      if (found === undefined) {
        throw new Error(`No ${commitState} History row for ${url}.`);
      }
      return found;
    };

    it("opens a recovered row from a deep link on a fresh load, past the first page", async () => {
      const target = row("wal_resident", RECOVERED_TARGET_URL);
      // The scenario needs the row outside the Recovered list's first page.
      const firstPage = await readApi<RowPage>(dashboard, "history", {
        "commit-state": "wal_resident",
        limit: "100",
      });
      expect(firstPage.nextCursor).not.toBeNull();
      expect(firstPage.items.map(urlOf)).not.toContain(RECOVERED_TARGET_URL);

      const ref = refOf(target);
      await open(
        "deep-link-recovered-row",
        deepLink("history", { tab: "recovered", row: ref }),
      );
      const opened = sheet(page, RECOVERED_TARGET_TITLE);
      await visible(opened);
      await visible(opened.getByText(RECOVERED_TARGET_URL, { exact: true }));
      await visible(opened.getByText(/recovered/i));
      expect(openRowOf(page)).toBe(ref);
      // Closing the sheet leaves the Recovered list on show.
      await page.keyboard.press("Escape");
      await visible(
        page.getByRole("tab", { name: /^Recovered/, selected: true }),
      );
      expect(openRowOf(page)).toBeNull();
    });

    it(
      titled(
        "lists hosts, opens a host's evidence, and lists a host seen only in a download",
        "S1",
      ),
      async () => {
        await open("sites-hosts", "#/sites");
        const hosts = page.getByRole("region", { name: "Observed hosts" });
        await visible(
          hosts.getByRole("button", {
            name: /^Show evidence for alpha\.example/,
          }),
        );
        await hosts
          .getByRole("button", {
            name: /^Show evidence for recovered\.example/,
          })
          .click();
        const detail = page.getByRole("region", { name: "recovered.example" });
        await visible(
          detail.getByRole("heading", { name: "recovered.example" }),
        );
        expect(new URL(page.url()).hash).toContain("host=recovered.example");

        await knownGap(
          "S1",
          `${DOWNLOAD_ONLY_HOST} (seen only in a download) is a Sites host`,
          async () => {
            const onlyDownload = hosts.getByRole("button", {
              name: new RegExp(
                `^Show evidence for ${DOWNLOAD_ONLY_HOST.replaceAll(".", "\\.")}`,
              ),
            });
            await visible(onlyDownload, GAP_TIMEOUT);
            await onlyDownload.click();
            const downloadHost = page.getByRole("region", {
              name: DOWNLOAD_ONLY_HOST,
            });
            await visible(
              downloadHost.getByText(DOWNLOAD_FILE_NAME),
              GAP_TIMEOUT,
            );
          },
        );
      },
    );

    it("⌘K finds a username and a download file, and Enter opens that exact row", async () => {
      const credentials = await readApi<RowPage>(dashboard, "credentials", {
        limit: "100",
      });
      const login = credentials.items.find(
        (item) => item.fields.usernameValue?.value === LOGINS[0].username,
      );
      const downloads = await readApi<RowPage>(dashboard, "downloads", {
        limit: "100",
      });
      expect(downloads.items).toHaveLength(1);

      await open("command-menu-jump", "#/overview");
      await visible(page.getByRole("heading", { level: 1 }));

      // A password is never an index entry.
      await page.keyboard.press("ControlOrMeta+k");
      const menu = page.getByRole("dialog", { name: "Jump to" });
      await menu
        .getByRole("combobox", { name: "Jump to" })
        .fill(LOGINS[0].password);
      await page.waitForTimeout(500);
      expect(await menu.getByRole("option").count()).toBe(0);
      await page.keyboard.press("Escape");

      const user = await jumpTo(
        page,
        LOGINS[0].username,
        new RegExp(`^${LOGINS[0].username.replace(".", "\\.")}`),
      );
      expect(await user.menu.getByRole("option").count()).toBe(1);
      await page.keyboard.press("Enter");
      await visible(sheet(page, "alpha.example"));
      expect(new URL(page.url()).hash).toMatch(/^#\/credentials\?/);
      expect(openRowOf(page)).toBe(refOf(login));

      const file = await jumpTo(
        page,
        "Quarterly_Ledger",
        new RegExp(`^${DOWNLOAD_FILE_NAME.replace(".", "\\.")}`),
      );
      expect(await file.menu.getByRole("option").count()).toBe(1);
      await page.keyboard.press("Enter");
      await visible(sheet(page, DOWNLOAD_FILE_NAME));
      expect(new URL(page.url()).hash).toMatch(/^#\/downloads\?/);
      expect(openRowOf(page)).toBe(refOf(downloads.items[0]));
    });

    it("hides a cookie value in the table and the sheet until revealed", async () => {
      await open("cookie-redaction", "#/cookies");
      const cookieRow = page.getByRole("row", {
        name: /alpha\.example session/,
      });
      await visible(cookieRow);
      await visible(cookieRow.getByText("value hidden"));
      expect(await page.getByText(COOKIE.value).count()).toBe(0);

      await cookieRow.click();
      const opened = sheet(page, /session/);
      await visible(opened);
      expect(await page.getByText(COOKIE.value).count()).toBe(0);
      await opened.getByRole("button", { name: "Reveal" }).click();
      await visible(opened.getByText(COOKIE.value, { exact: true }));
    });

    it(
      titled(
        "hides a saved password by default, reveals it, and hides the next row's again",
        "F2",
      ),
      async () => {
        const [first, second] = LOGINS;
        await open("password-reveal", "#/credentials");
        const table = page.getByRole("region", { name: "Stored logins" });
        await visible(table.getByRole("row", { name: /grace\.hopper/ }));
        // Neither password is on screen in the list.
        for (const login of LOGINS) {
          expect(await page.getByText(login.password).count()).toBe(0);
        }
        await table.getByRole("row", { name: /ada\.lovelace/ }).click();
        const firstSheet = sheet(page, "alpha.example");
        await visible(firstSheet);
        await visible(firstSheet.getByText("value hidden"));
        expect(await page.getByText(first.password).count()).toBe(0);
        await firstSheet.getByRole("button", { name: "Reveal" }).click();
        await visible(firstSheet.getByText(first.password, { exact: true }));

        // Switch rows without closing the sheet (⌘K from inside it).
        await jumpTo(page, second.username, /^grace\.hopper/);
        await page.keyboard.press("Enter");
        const secondSheet = sheet(page, "beta.example");
        await visible(secondSheet);
        await visible(secondSheet.getByText(second.username, { exact: true }));

        await knownGap(
          "F2",
          "the next row's password is hidden after a reveal",
          async () => {
            expect(await page.getByText(second.password).count()).toBe(0);
            await visible(secondSheet.getByText("value hidden"), GAP_TIMEOUT);
            await visible(
              secondSheet.getByRole("button", { name: "Reveal" }),
              GAP_TIMEOUT,
            );
          },
        );
      },
    );

    it(
      titled(
        "says nothing about a topic model when the Case has no topic Candidates",
        "F1",
      ),
      async () => {
        const candidates = await readApi<RowPage>(
          dashboard,
          "topic-candidates",
          {
            limit: "1",
          },
        );
        expect(candidates.items).toHaveLength(0);

        await open("overview-topic-line", "#/overview");
        const topic = page.getByRole("region", {
          name: "Topic categorization",
        });
        await visible(topic);
        // The Case was analysed with classification off: no model state at
        // all, so any model reason on the line is invented.
        await knownGap(
          "F1",
          "the topic line invents no model reason",
          async () => {
            const text = (await topic.innerText()).toLowerCase();
            for (const invented of [
              "not downloaded",
              "not installed",
              "failed to load",
              "failed mid-run",
            ]) {
              expect(text).not.toContain(invented);
            }
          },
        );
      },
    );

    it(
      titled("opens a Timeline deep-linked row it has not loaded", "F3"),
      async () => {
        const newest = await readApi<RowPage>(dashboard, "timeline", {
          limit: "100",
        });
        const oldestVisit = row("committed", OLDEST_VISIT_URL);
        // The scenario needs the row outside the Timeline's first page.
        expect(newest.nextCursor).not.toBeNull();
        expect(newest.items.map(rowRefOf)).not.toContain(refOf(oldestVisit));

        // A linked row the Timeline has loaded opens (the set-up works).
        const loaded = newest.items.find(
          (item) => item.findingKind === "history_visit",
        );
        const loadedTitle = loaded?.fields.title?.value;
        expect(typeof loadedTitle).toBe("string");
        await open(
          "timeline-deep-link",
          deepLink("timeline", { row: refOf(loaded) }),
        );
        await visible(sheet(page, String(loadedTitle)));

        await page.goto(
          `${dashboard.url}${deepLink("timeline", { row: refOf(oldestVisit) })}`,
        );
        await page.reload();
        await visible(
          page.getByRole("heading", { name: "Timeline", level: 1 }),
        );
        await knownGap(
          "F3",
          "the Timeline looks up and opens a row past its first page",
          async () => {
            await visible(
              sheet(page, String(oldestVisit.fields.title?.value)),
              GAP_TIMEOUT * 2,
            );
          },
        );
      },
    );

    it("restores the range and the open row on Back and Forward", async () => {
      const lastDay = HISTORY_DAYS.at(-1) ?? "";
      await open("back-forward", "#/history");
      const activity = page.getByRole("region", { name: "Browsing activity" });
      // Pick the last day on the chart from the keyboard.
      const chart = activity.getByRole("application", {
        name: /^Page visits per day/,
      });
      await chart.focus();
      await page.keyboard.press("End");
      await page.keyboard.press("Enter");
      await page.waitForURL(/from=/);
      expect(rangeOf(page)).toEqual([lastDay, lastDay]);
      const visits = page.getByRole("region", { name: "Recorded visits" });
      const newest = visits.getByRole("row", { name: /Alpha page 179 / });
      await newest.click();
      await visible(sheet(page, "Alpha page 179"));
      const historyRef = openRowOf(page);
      expect(historyRef).toBe(
        refOf(row("committed", "https://alpha.example/page-179")),
      );

      // Leave for the Timeline from inside the sheet; the range travels.
      const timelinePick = await jumpTo(page, "Timeline", /^Timeline/);
      await timelinePick.match.click();
      await visible(page.getByRole("heading", { name: "Timeline", level: 1 }));
      expect(rangeOf(page)).toEqual([lastDay, lastDay]);
      expect(openRowOf(page)).toBeNull();

      await page.goBack();
      // (The page behind the modal sheet is hidden from the accessibility
      // tree, so the URL says which page it is.)
      await visible(sheet(page, "Alpha page 179"));
      expect(new URL(page.url()).hash).toMatch(/^#\/history\?/);
      expect(openRowOf(page)).toBe(historyRef);
      expect(rangeOf(page)).toEqual([lastDay, lastDay]);

      await page.goForward();
      await visible(page.getByRole("heading", { name: "Timeline", level: 1 }));
      expect(await page.getByRole("dialog").count()).toBe(0);
      expect(rangeOf(page)).toEqual([lastDay, lastDay]);
      await visible(
        page
          .getByRole("group", { name: "Date range" })
          .getByRole("button", { name: "13 Mar 2024" }),
      );

      // And Back once more opens the same row again.
      await page.goBack();
      await visible(sheet(page, "Alpha page 179"));
      expect(openRowOf(page)).toBe(historyRef);
    });
  },
);
