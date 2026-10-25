/**
 * The page component for every page key (the registry's React half: what
 * each page is lives in `pages.ts`, its icon in `ARTIFACT_ICONS`). Typed
 * over every `PageKey`, so a page added to the registry without a
 * component is a compile error, never a blank screen.
 */
import type { ComponentType } from "react";

import { AutofillPage } from "./components/autofill-page.js";
import { BookmarksPage } from "./components/bookmarks-page.js";
import { CachePage } from "./components/cache-page.js";
import { CookiesPage } from "./components/cookies-page.js";
import { CredentialsPage } from "./components/credentials-page.js";
import { DownloadsPage } from "./components/downloads-page.js";
import { FaviconsPage } from "./components/favicons-page.js";
import { HistoryPage } from "./components/history-page.js";
import { MetadataPage } from "./components/metadata-page.js";
import { SitesPage } from "./components/sites-page.js";
import { TimelinePage } from "./components/timeline-page.js";
import { TopSitesPage } from "./components/top-sites-page.js";
import { OverviewPage } from "./overview.js";
import type { PageKey } from "./pages.js";

export const PAGE_COMPONENTS: Readonly<Record<PageKey, ComponentType>> = {
  overview: OverviewPage,
  timeline: TimelinePage,
  sites: SitesPage,
  history: HistoryPage,
  downloads: DownloadsPage,
  bookmarks: BookmarksPage,
  "top-sites": TopSitesPage,
  cookies: CookiesPage,
  credentials: CredentialsPage,
  autofill: AutofillPage,
  cache: CachePage,
  favicons: FaviconsPage,
  metadata: MetadataPage,
};
