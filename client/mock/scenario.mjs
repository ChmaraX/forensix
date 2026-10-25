/**
 * The design mock's scenario: who the subject is, which sites they use and
 * what each page is called, and the dated story events. Design-only, like
 * case-data.mjs. All people, companies, accounts and IDs are fictional;
 * public sites appear with their own page titles and favicons, for
 * illustration only.
 *
 * Story: Olivia Bennett, a senior product designer at Halden (a fictional
 * London startup), accepts an offer from a competitor, Lumenworks (also fictional).
 * In her last week she downloads design files, customer research and a
 * customer export late at night, sends them out through WeTransfer and
 * Dropbox, and clears her browsing history. The cleared visits survive in
 * the History WAL, so they come back as recovered rows.
 */

export const PERSONA = {
  fullName: "Olivia Bennett",
  givenName: "Olivia",
  workEmail: "olivia.bennett@halden.io",
  personalEmail: "olivia.bennett.design@gmail.com",
  privateEmail: "obennett@proton.me",
  phone: "+44 20 7946 0187",
  street: "48 Columbia Road",
  city: "London",
  zip: "E2 7RG",
  country: "GB",
  osUser: "obennett",
  company: "Halden",
  competitor: "Lumenworks",
};

export const DOWNLOADS_DIR = `/Users/${PERSONA.osUser}/Downloads`;

/**
 * Every site in the scenario. `kind` drives when it is visited: `work` on
 * weekdays in office hours, `personal` in evenings and at weekends, `story`
 * only through dated story events. `weight` is how often a routine visit
 * picks it. `pages` are `[path, title]`.
 */
export const SITES = [
  {
    host: "app.slack.com",
    kind: "work",
    weight: 16,
    pages: [
      ["/client/T04HALDEN/C02DESIGN", "#design | Halden | Slack"],
      ["/client/T04HALDEN/C03PRODUCT", "#product-launch | Halden | Slack"],
      ["/client/T04HALDEN/C01GENERAL", "#general | Halden | Slack"],
      ["/client/T04HALDEN/D05MAYA", "Maya Chen (DM) | Halden | Slack"],
    ],
  },
  {
    host: "www.figma.com",
    kind: "work",
    weight: 15,
    pages: [
      ["/design/kL9xQ/Design-System-v4", "Design System v4 – Figma"],
      ["/design/Pq2cT/Checkout-Redesign", "Checkout Redesign – Figma"],
      ["/design/Zt7mR/Mobile-App-2.0", "Mobile App 2.0 – Figma"],
      ["/files/team/1180/Halden", "Halden – Figma"],
    ],
  },
  {
    host: "linear.app",
    kind: "work",
    weight: 8,
    pages: [
      ["/halden/team/DES/active", "Design › Active issues · Linear"],
      [
        "/halden/issue/DES-482/onboarding-empty-states",
        "DES-482 Onboarding empty states · Linear",
      ],
      [
        "/halden/issue/DES-497/checkout-error-copy",
        "DES-497 Checkout error copy · Linear",
      ],
    ],
  },
  {
    host: "www.notion.so",
    kind: "work",
    weight: 7,
    pages: [
      ["/halden/Product-Roadmap-Q2-2024-3f9a", "Product Roadmap Q2 2024"],
      ["/halden/Design-Critique-Notes-8b21", "Design Critique Notes"],
      ["/halden/Customer-Research-Hub-c41e", "Customer Research Hub"],
    ],
  },
  {
    host: "mail.google.com",
    kind: "work",
    weight: 9,
    pages: [
      [
        "/mail/u/0/#inbox",
        "Inbox (12) - olivia.bennett@halden.io - Halden Mail",
      ],
      ["/mail/u/0/#sent", "Sent Mail - olivia.bennett@halden.io - Halden Mail"],
    ],
  },
  {
    host: "calendar.google.com",
    kind: "work",
    weight: 5,
    pages: [["/calendar/u/0/r/week", "Halden - Calendar - Week view"]],
  },
  {
    host: "docs.google.com",
    kind: "work",
    weight: 6,
    pages: [
      [
        "/spreadsheets/d/1XvPricing2024/edit",
        "Pricing Strategy 2024 - Google Sheets",
      ],
      ["/document/d/1hQHiringPlan/edit", "Design Hiring Plan - Google Docs"],
      [
        "/presentation/d/1KcBoardMarch/edit",
        "Board Update – March - Google Slides",
      ],
    ],
  },
  {
    host: "drive.google.com",
    kind: "work",
    weight: 4,
    pages: [
      ["/drive/folders/0BDesignTeam", "Design - Google Drive"],
      ["/drive/folders/0BResearch", "Customer Research - Google Drive"],
    ],
  },
  {
    host: "github.com",
    kind: "work",
    weight: 4,
    pages: [
      ["/halden/web-app/pulls", "Pull requests · halden/web-app"],
      ["/halden/design-tokens", "halden/design-tokens: Halden design tokens"],
    ],
  },
  {
    host: "meet.google.com",
    kind: "work",
    weight: 3,
    pages: [["/xkd-ptqa-rnm", "Meet - Design sync"]],
  },
  {
    host: "app.halden.io",
    kind: "work",
    weight: 3,
    pages: [
      ["/dashboard", "Dashboard · Halden"],
      ["/settings/billing", "Billing · Halden"],
    ],
  },
  {
    host: "www.google.com",
    kind: "both",
    weight: 6,
    pages: [
      [
        "/search?q=figma+auto+layout+wrap",
        "figma auto layout wrap - Google Search",
      ],
      [
        "/search?q=empty+state+design+examples",
        "empty state design examples - Google Search",
      ],
      ["/search?q=tfl+strike+dates", "tfl strike dates - Google Search"],
      [
        "/search?q=best+ramen+shoreditch",
        "best ramen shoreditch - Google Search",
      ],
    ],
  },
  {
    host: "www.youtube.com",
    kind: "personal",
    weight: 9,
    pages: [
      [
        "/watch?v=Dtd40cHQQlk",
        "Designing a design system from scratch – Config 2023 - YouTube",
      ],
      [
        "/watch?v=jfKfPfyJRdk",
        "lofi hip hop radio – beats to relax/study to - YouTube",
      ],
      ["/", "YouTube"],
    ],
  },
  {
    host: "open.spotify.com",
    kind: "personal",
    weight: 4,
    pages: [
      ["/playlist/37i9dQZF1DX8NTLI2TtZa6", "Deep Focus | Spotify Playlist"],
    ],
  },
  {
    host: "www.reddit.com",
    kind: "personal",
    weight: 5,
    pages: [
      ["/r/UXDesign/", "UX Design - Reddit"],
      ["/r/london/", "London - Reddit"],
    ],
  },
  {
    host: "news.ycombinator.com",
    kind: "personal",
    weight: 4,
    pages: [["/", "Hacker News"]],
  },
  {
    host: "www.nytimes.com",
    kind: "personal",
    weight: 3,
    pages: [["/section/technology", "Technology - The New York Times"]],
  },
  {
    host: "dribbble.com",
    kind: "personal",
    weight: 3,
    pages: [["/shots/popular", "Popular shots on Dribbble"]],
  },
  {
    host: "www.amazon.com",
    kind: "personal",
    weight: 2,
    pages: [
      ["/gp/your-account/order-history", "Your Orders"],
      ["/dp/B0C1RNL5MK", "Amazon.com: Ergonomic Office Chair"],
    ],
  },
  {
    host: "en.wikipedia.org",
    kind: "personal",
    weight: 2,
    pages: [["/wiki/Gestalt_psychology", "Gestalt psychology - Wikipedia"]],
  },
  {
    host: "www.linkedin.com",
    kind: "personal",
    weight: 2,
    pages: [
      ["/feed/", "Feed | LinkedIn"],
      [
        "/jobs/view/3871234501",
        "Lead Product Designer | Lumenworks | LinkedIn",
      ],
      ["/messaging/", "Messaging | LinkedIn"],
    ],
  },
  {
    host: "www.airbnb.com",
    kind: "story",
    weight: 0,
    pages: [
      ["/rooms/53814822", "Alfama loft with river view · Lisbon · Airbnb"],
      ["/trips", "Trips · Airbnb"],
    ],
  },
  {
    host: "lumenworks.io",
    kind: "story",
    weight: 0,
    pages: [
      [
        "/careers/lead-product-designer",
        "Lead Product Designer — Lumenworks Careers",
      ],
      ["/onboarding/welcome", "Welcome to Lumenworks — Onboarding"],
    ],
  },
  {
    host: "mail.proton.me",
    kind: "story",
    weight: 0,
    pages: [["/u/0/inbox", "Inbox | obennett@proton.me | Proton Mail"]],
  },
  {
    host: "wetransfer.com",
    kind: "story",
    weight: 0,
    pages: [
      ["/", "WeTransfer | Send large files"],
      ["/transfer/complete", "Transfer complete | WeTransfer"],
    ],
  },
  {
    host: "www.dropbox.com",
    kind: "story",
    weight: 0,
    pages: [
      ["/home/Portfolio", "Portfolio - Dropbox"],
      ["/home/Archive%202024", "Archive 2024 - Dropbox"],
    ],
  },
];

export function siteOf(host) {
  const site = SITES.find((entry) => entry.host === host);
  if (site === undefined) throw new Error(`Unknown scenario host: ${host}`);
  return site;
}

/** The Case's first and last day (UTC), and the days with no browsing: a
 *  four-day Easter trip to Lisbon. */
export const FIRST_DAY = "2024-03-04";
export const LAST_DAY = "2024-04-15";
export const TRIP_DAYS = [
  "2024-03-29",
  "2024-03-30",
  "2024-03-31",
  "2024-04-01",
];

/** The subject cleared browsing history at this instant. Visits from
 *  `CLEARED_FROM` to it were removed from the saved History database and
 *  survive only in its WAL file: they come back recovered. */
export const CLEARED_FROM = "2024-04-10T18:00:00.000Z";
export const CLEARED_AT = "2024-04-12T23:52:00.000Z";

/** Dated story visits: `[utc, host, pageIndex]`. */
export const STORY_VISITS = [
  ["2024-03-14T21:12:08.000Z", "www.linkedin.com", 1],
  ["2024-03-14T21:15:40.000Z", "lumenworks.io", 0],
  ["2024-03-19T20:41:02.000Z", "www.dropbox.com", 0],
  ["2024-03-21T12:31:55.000Z", "lumenworks.io", 0],
  ["2024-03-26T18:05:12.000Z", "www.linkedin.com", 2],
  ["2024-03-28T20:02:33.000Z", "www.airbnb.com", 0],
  ["2024-03-28T20:09:47.000Z", "www.airbnb.com", 1],
  ["2024-04-08T19:44:10.000Z", "mail.proton.me", 0],
  ["2024-04-08T19:51:26.000Z", "lumenworks.io", 1],
  // The last week: late-night collection and transfer (cleared, recovered).
  ["2024-04-10T22:38:04.000Z", "www.figma.com", 0],
  ["2024-04-10T22:58:41.000Z", "drive.google.com", 1],
  ["2024-04-10T23:47:19.000Z", "app.halden.io", 0],
  ["2024-04-11T00:09:52.000Z", "docs.google.com", 0],
  ["2024-04-11T00:18:30.000Z", "www.notion.so", 0],
  ["2024-04-11T00:29:06.000Z", "app.halden.io", 1],
  ["2024-04-11T00:44:13.000Z", "wetransfer.com", 0],
  ["2024-04-11T01:26:57.000Z", "wetransfer.com", 1],
  ["2024-04-11T01:31:40.000Z", "mail.proton.me", 0],
  ["2024-04-12T21:15:22.000Z", "www.dropbox.com", 1],
  ["2024-04-12T21:40:05.000Z", "www.google.com", -1],
  ["2024-04-12T23:49:37.000Z", "mail.proton.me", 0],
];

/** A story search that is not one of www.google.com's routine pages. */
export const STORY_SEARCH = [
  "/search?q=clear+chrome+history+mac",
  "clear chrome history mac - Google Search",
];

/** Downloads: `[startUtc, file, host, mime, bytes, state]`. */
export const DOWNLOAD_ITEMS = [
  [
    "2024-03-05T09:12:40.000Z",
    "Figma-124.1.12.dmg",
    "www.figma.com",
    "application/x-apple-diskimage",
    241_884_160,
    "complete",
  ],
  [
    "2024-03-19T20:43:18.000Z",
    "Olivia_Bennett_Portfolio_2024.pdf",
    "www.dropbox.com",
    "application/pdf",
    18_402_311,
    "complete",
  ],
  [
    "2024-03-28T20:11:02.000Z",
    "Airbnb_Receipt_HMXK4PQ2.pdf",
    "www.airbnb.com",
    "application/pdf",
    214_880,
    "complete",
  ],
  [
    "2024-04-08T19:47:55.000Z",
    "Lumenworks_Offer_Letter.pdf",
    "mail.proton.me",
    "application/pdf",
    391_204,
    "complete",
  ],
  [
    "2024-04-10T22:40:11.000Z",
    "Design_System_v4.fig",
    "www.figma.com",
    "application/octet-stream",
    96_212_480,
    "complete",
  ],
  [
    "2024-04-10T23:01:27.000Z",
    "Customer_Research_Interviews_2024.zip",
    "drive.google.com",
    "application/zip",
    1_472_118_784,
    "interrupted",
  ],
  [
    "2024-04-10T23:19:45.000Z",
    "Customer_Research_Interviews_2024.zip",
    "drive.google.com",
    "application/zip",
    1_472_118_784,
    "complete",
  ],
  [
    "2024-04-10T23:49:02.000Z",
    "halden_customers_export.csv",
    "app.halden.io",
    "text/csv",
    8_904_117,
    "complete",
  ],
  [
    "2024-04-11T00:11:30.000Z",
    "Pricing_Strategy_2024.xlsx",
    "docs.google.com",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    1_204_992,
    "complete",
  ],
  [
    "2024-04-11T00:19:58.000Z",
    "Product_Roadmap_Q2_2024.pdf",
    "www.notion.so",
    "application/pdf",
    3_118_406,
    "complete",
  ],
];

/** Saved logins: `[host, loginPath, username, createdUtc, lastUsedUtc, timesUsed]`. */
export const LOGIN_ITEMS = [
  [
    "app.slack.com",
    "/signin",
    PERSONA.workEmail,
    "2023-06-12T16:02:00.000Z",
    "2024-04-15T08:58:00.000Z",
    86,
  ],
  [
    "www.figma.com",
    "/login",
    PERSONA.workEmail,
    "2023-06-12T16:20:00.000Z",
    "2024-04-10T22:37:00.000Z",
    64,
  ],
  [
    "linear.app",
    "/login",
    PERSONA.workEmail,
    "2023-06-13T09:41:00.000Z",
    "2024-04-12T10:12:00.000Z",
    41,
  ],
  [
    "www.notion.so",
    "/login",
    PERSONA.workEmail,
    "2023-06-13T09:55:00.000Z",
    "2024-04-11T00:17:00.000Z",
    37,
  ],
  [
    "github.com",
    "/login",
    "obennett-halden",
    "2023-07-02T11:08:00.000Z",
    "2024-04-09T15:30:00.000Z",
    22,
  ],
  [
    "app.halden.io",
    "/login",
    "obennett@halden.io",
    "2023-06-14T10:00:00.000Z",
    "2024-04-11T00:28:00.000Z",
    19,
  ],
  [
    "www.linkedin.com",
    "/login",
    PERSONA.personalEmail,
    "2022-02-03T19:30:00.000Z",
    "2024-03-26T18:04:00.000Z",
    14,
  ],
  [
    "www.dropbox.com",
    "/login",
    PERSONA.personalEmail,
    "2021-11-20T15:12:00.000Z",
    "2024-04-12T21:14:00.000Z",
    9,
  ],
  [
    "wetransfer.com",
    "/signin",
    PERSONA.privateEmail,
    "2024-04-11T00:42:00.000Z",
    "2024-04-11T00:42:00.000Z",
    1,
  ],
  [
    "mail.proton.me",
    "/login",
    PERSONA.privateEmail,
    "2024-04-08T19:43:00.000Z",
    "2024-04-12T23:49:00.000Z",
    4,
  ],
  [
    "www.airbnb.com",
    "/login",
    PERSONA.personalEmail,
    "2022-08-14T20:00:00.000Z",
    "2024-03-28T20:01:00.000Z",
    6,
  ],
  [
    "www.amazon.com",
    "/ap/signin",
    PERSONA.personalEmail,
    "2020-05-02T18:00:00.000Z",
    "2024-03-23T11:40:00.000Z",
    31,
  ],
];

/** Bookmarks: `[name, url, folder, addedUtc]`. */
export const BOOKMARK_ITEMS = [
  [
    "Halden Slack",
    "https://app.slack.com/client/T04HALDEN/C02DESIGN",
    "Bookmarks Bar / Halden",
    "2023-06-12T16:05:00.000Z",
  ],
  [
    "Design System v4",
    "https://www.figma.com/design/kL9xQ/Design-System-v4",
    "Bookmarks Bar / Halden",
    "2023-09-04T10:22:00.000Z",
  ],
  [
    "Linear – Design team",
    "https://linear.app/halden/team/DES/active",
    "Bookmarks Bar / Halden",
    "2023-06-13T09:44:00.000Z",
  ],
  [
    "Roadmap Q2 2024",
    "https://www.notion.so/halden/Product-Roadmap-Q2-2024-3f9a",
    "Bookmarks Bar / Halden",
    "2024-03-06T14:10:00.000Z",
  ],
  [
    "Customer Research Hub",
    "https://www.notion.so/halden/Customer-Research-Hub-c41e",
    "Bookmarks Bar / Halden",
    "2023-11-02T13:30:00.000Z",
  ],
  [
    "Popular on Dribbble",
    "https://dribbble.com/shots/popular",
    "Bookmarks Bar / Inspiration",
    "2022-05-18T21:00:00.000Z",
  ],
  [
    "Deep Focus",
    "https://open.spotify.com/playlist/37i9dQZF1DX8NTLI2TtZa6",
    "Bookmarks Bar",
    "2023-01-09T08:30:00.000Z",
  ],
  [
    "Lead Product Designer — Lumenworks",
    "https://lumenworks.io/careers/lead-product-designer",
    "Other Bookmarks / Next",
    "2024-03-14T21:16:00.000Z",
  ],
  [
    "Portfolio – Dropbox",
    "https://www.dropbox.com/home/Portfolio",
    "Other Bookmarks / Next",
    "2024-03-19T20:42:00.000Z",
  ],
  [
    "WeTransfer",
    "https://wetransfer.com/",
    "Other Bookmarks / Next",
    "2024-04-11T00:45:00.000Z",
  ],
  [
    "Lisbon – Alfama loft",
    "https://www.airbnb.com/rooms/53814822",
    "Other Bookmarks / Travel",
    "2024-03-28T20:05:00.000Z",
  ],
];

/** Autofill entries: `[fieldName, value]` (all in the Default Profile). */
export const AUTOFILL_ITEMS = [
  ["NAME_FULL", PERSONA.fullName],
  ["NAME_FIRST", PERSONA.givenName],
  ["EMAIL_ADDRESS", PERSONA.workEmail],
  ["EMAIL_ADDRESS", PERSONA.personalEmail],
  ["EMAIL_ADDRESS", PERSONA.privateEmail],
  ["PHONE_HOME_WHOLE_NUMBER", PERSONA.phone],
  ["ADDRESS_HOME_STREET_ADDRESS", PERSONA.street],
  ["ADDRESS_HOME_CITY", PERSONA.city],
  ["ADDRESS_HOME_ZIP", PERSONA.zip],
  ["ADDRESS_HOME_COUNTRY", PERSONA.country],
  ["COMPANY_NAME", PERSONA.company],
  ["q", "figma auto layout wrap"],
  ["q", "lumenworks lead product designer salary"],
  ["q", "wetransfer max file size free"],
  ["q", "clear chrome history mac"],
];

/** Cookie names per host (the first is the session cookie). */
export const COOKIE_NAMES = {
  "app.slack.com": ["d", "lc", "b"],
  "www.figma.com": ["__Host-figma.authn", "figma.session"],
  "linear.app": ["session", "ajs_anonymous_id"],
  "www.notion.so": ["token_v2", "notion_browser_id"],
  "mail.google.com": ["OSID", "COMPASS"],
  "github.com": ["user_session", "_gh_sess", "logged_in"],
  "app.halden.io": ["halden_session"],
  "www.youtube.com": ["VISITOR_INFO1_LIVE", "YSC"],
  "www.linkedin.com": ["li_at", "JSESSIONID", "bcookie"],
  "www.dropbox.com": ["t", "lid"],
  "wetransfer.com": ["wt_session"],
  "mail.proton.me": ["Session-Id", "AUTH-x"],
  "www.airbnb.com": ["_airbed_session_id", "bev"],
  "www.amazon.com": ["session-id", "ubid-main"],
  "www.reddit.com": ["reddit_session", "loid"],
  "open.spotify.com": ["sp_dc", "sp_t"],
};

/** Hosts whose favicon is a stored PNG in `favicons/`; others get an SVG
 *  mark drawn here (the fictional companies). */
export const FICTIONAL_MARKS = {
  "app.halden.io": { fill: "#111827", glyph: "H" },
  "lumenworks.io": { fill: "#f59e0b", glyph: "L" },
};
