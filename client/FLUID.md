# Fluid Functionalism in the ForensiX client

Every page uses [Fluid Functionalism](https://www.fluidfunctionalism.com) (FF):
its components, its motion system, and its look. This file covers how to do
that here. For the system itself, read the FF skill in this order:
`/tmp/ff/fluid-functionalism/skills/fluid-functionalism/SKILL.md`, then
`references/craft.md` (the section for each component before you compose it)
and `references/custom-motion.md` (before you write any animation or hover by
hand). The installed source has the final say: `src/components/ui/*`,
`src/lib/*`, `src/hooks/*`.

## Ground rules

- **Use FF parts first.** Use an installed component if one fits. If none
  does, compose one from FF parts (`Elevated`, `useFluidHover` +
  `FluidHoverHighlight`, `spring`, `fontWeights`, `typeClass`). Do a bespoke
  build only as a last resort.
- **Don't edit installed FF files** (the `ui/` files from the registry, plus
  `lib/`, `hooks/`, `sidebar-app/`, and `fluid-hover-highlight.tsx`). Wrap or
  compose them instead. They stay byte-faithful to the registry:
  `node /tmp/ff/fluid-functionalism/skills/fluid-functionalism/scripts/upgrade.mjs client`
  must keep saying `CURRENT`. Prettier skips them, and lint waives two
  upstream style rules for them (see `.prettierignore` and
  `eslint.config.mjs`).
- **Imports:** in new code, use `@/…` paths, e.g.
  `import { Button } from "@/components/ui/button"`. Existing relative `.js`
  imports still work.
- **Adding an FF item:** run `cd client && pnpm dlx shadcn@latest add @fluid/<name>`.
  This is the Radix flavor, so use bare names, never `base/`. Diff any file
  the CLI wants to overwrite first. If it rewrites `src/lib/utils.ts` to
  shadcn's stock version, run `pnpm dlx shadcn@latest add @fluid/utils --overwrite`
  afterwards. Run the CLI only from `client/`.
- **Don't add hand-written timings,** apart from the 80ms color/weight
  transitions FF itself uses (`duration-80`). For anything else, use
  `spring.fast | moderate | slow`, with `.exit` for dismissals.

## What is installed

| Area                               | Files                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Components (`src/components/ui/`)  | accordion, badge, banner, button, card, checkbox-group, combobox, command-menu, dialog, dropdown (+ dropdown-search, dropdown-sub, menu-item), input-copy, input-group, mobile-drawer, radio-group, scroll-area, select, sidebar (+ sidebar-core, sidebar-menu), skeleton, slider, switch, table, tabs, tabs-subtle, tooltip                                                                                         |
| Systems (`src/lib/`, `src/hooks/`) | springs, font-weight, size-context, type-scale, shape-context, surface-context, surface-classes, elevated, icon-context, popup, omit, utils (`cn`), fluid-provider, sidebar-menu-grid; hooks: use-fluid-hover, use-merge-split, use-keyboard-nav-gate, use-touch-primary; `src/components/fluid-hover-highlight.tsx`                                                                                                 |
| CSS (`src/app.css`)                | FF tokens, the surface and shadow ladders, the type scale, `.typeset`, native scrollbars, `scroll-fade` / `scroll-fade-x` / `scroll-divider`, and `reveal-*`                                                                                                                                                                                                                                                         |
| Block                              | `src/components/sidebar-app/*` (App Sidebar: `inset-topbar`, `search-field`, `user-footer`, `workspace-header`). The block's demo assembly (`app-sidebar.tsx`, `nav-data.ts`) was removed as unused; the real shell lives in `src/app.tsx`.                                                                                                                                                                          |
| Built on FF here                   | `ui/popover.tsx`, `ui/sheet.tsx`, `ui/misc.tsx` (Skeleton), `components/panel.tsx`, `components/evidence.tsx`, `components/term.tsx`, `components/list-states.tsx`, `components/page-kit.tsx` (see "The page kit"), `components/completeness.tsx`, `components/row-sheet.tsx`, `components/form-data.ts`, `components/metric-band.tsx`, `components/activity-data.ts`, `components/charts.tsx` + `chart-section.tsx` |

## The shell (do not restyle it per page)

`src/app.tsx` lays the page out like this: `FluidProvider` (reduced motion,
shape, size, and icons) → `TooltipProvider` → `SidebarProvider` →
`CaseSidebar` + `SidebarInset` → the topbar breadcrumb → **one
`reveal-product` column** with the page header and your page.

- The column already fades the page in: the header first, then your page
  root. **Do not put `reveal-product` or `reveal-landing` on your page.** That
  would animate a parent and its children both. For data that loads slowly,
  use `reveal-swap` + `reveal-items` (see Loading below).
- The sticky topbar (breadcrumb) is wrapped in `.inset-topbar` (app.css,
  section 8): it sticks 8px down, wears the inset's surface-2, top radius
  and ring, and once the page scrolls FF's scroll-divider hairline plus a
  short surface fade appear under it. Rows pass under it, never through it.
- Every page except Overview receives the Case-wide Completeness Statement
  as a `completeness: CaseCompleteness` prop (the shell reads it once) and
  renders `CompletenessPanel` first (see "Evidence coverage").
- The column provides **surface level 2**. A `Panel` lands on surface 3, and
  popups and dialogs open from there and walk further up the ladder on their
  own.
- Pages start at the top of the page. The document scrolls, not the inset, so
  sticky elements stick to the viewport.

## Which component for which need

| Dashboard need                                                                    | Use                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framed section (stat band, chart, table card)                                     | `SectionPanel` from page-kit (or the raw `Panel`, `PanelHeader`, `PanelTitle`, `PanelDescription`, `PanelContent`, `PanelFooter` from `@/components/panel` when it doesn't fit). Heading level: `PanelTitle as="h3"` / `SectionPanel headingAs`, never `role="heading"`                             |
| Chart panel                                                                       | `ChartSection` (`action` for a control, `footer` for a note)                                                                                                                                                                                                                                        |
| Saved vs recovered rows                                                           | `useCommitStateLists` + `CommitStateSplit` (see "Saved and recovered rows")                                                                                                                                                                                                                         |
| Clickable card grid or list (e.g. Top sites tiles)                                | FF `CardGroup` + `Card` (`columns` > 1 gives 2-D fluid hover). Its cards are transparent on purpose, so put the group inside a Panel if it needs a frame                                                                                                                                            |
| Evidence table                                                                    | FF `Table`, `TableHeader`, `TableBody`, `TableRow index={i}` (body rows only), `TableHead`, `TableCell`. Rows sit on the 36px ladder, or 28px with `size="compact"`. **TYPE is the first column.** For wide tables, use `scroll-fade-x` on the scroller                                             |
| Row detail side panel                                                             | `RowSheet` from `components/row-sheet` (built on `Sheet`; `redactedFields` hides secrets until revealed). Raw `Sheet` + `SheetContent` (+ `SheetHeader`, `SheetTitle`, `SheetDescription`, `SheetBody`, `SheetFooter`) only for a non-row sheet                                                     |
| Modal                                                                             | FF `Dialog` (`size` sm, lg, or xl)                                                                                                                                                                                                                                                                  |
| Single-choice filter (sort, transition, profile)                                  | FF `Select` (`SelectTrigger`, `SelectContent`, `SelectItem index value`). `size="compact"` in filter bars                                                                                                                                                                                           |
| Searchable, multi-pick, or create filter                                          | FF `Combobox`                                                                                                                                                                                                                                                                                       |
| Text search field                                                                 | FF `InputGroup` + `InputField` (with `labelHidden` and the `search` icon for a toolbar search). `misc.Input` is only for legacy forms                                                                                                                                                               |
| Segmented control (2–4 mutually exclusive views, e.g. newest/oldest, bytes/count) | FF `Tabs` + `TabsList` + `TabItem` (`size="compact"` in a toolbar); `CommitStateSplit` for saved/recovered                                                                                                                                                                                          |
| Tab navigation inside a page (e.g. per-profile sections)                          | FF `TabsSubtle` + `TabsSubtleItem`                                                                                                                                                                                                                                                                  |
| Multi-select toggles (event types, profiles)                                      | FF `CheckboxGroup` in a popover or panel (`ProfilePicker`); a one-of filter (event type) is an FF `Select` with an "All" item                                                                                                                                                                       |
| Actions menu or "more"                                                            | FF `DropdownMenu`, `DropdownTrigger`, `DropdownContent`, `MenuItem`                                                                                                                                                                                                                                 |
| Anchored panel (date range calendar, etc.)                                        | `Popover`, `PopoverTrigger`, `PopoverContent` from `@/components/ui/popover` (`flush` drops the 4px padding)                                                                                                                                                                                        |
| Copy a hash, path, or URL                                                         | FF `InputCopy`                                                                                                                                                                                                                                                                                      |
| Show/hide details                                                                 | FF `Accordion`                                                                                                                                                                                                                                                                                      |
| Toggle a setting                                                                  | FF `Switch`                                                                                                                                                                                                                                                                                         |
| Jump-to / ⌘K                                                                      | FF `CommandMenuDialog`                                                                                                                                                                                                                                                                              |
| Buttons                                                                           | FF `Button`: `primary` for the one main action, `secondary` for ordinary actions, `tertiary` for bordered or quiet actions ("Load more"), `ghost` for icon and toolbar buttons. Sizes: default 36px, `compact` 28px, `icon` / `icon-compact`. Use the `loading` prop rather than swapping the label |
| Evidence-state chip                                                               | `EvidenceBadge state="produced \| unavailable \| absent \| empty \| committed \| wal \| journal \| warning"` with the **state word as its children**                                                                                                                                                |
| State word in a cell or text                                                      | `EvidenceDot state=…` + the word on `text-foreground` or `text-muted-foreground` (`state="neutral"`, a hollow ring, for plain labels such as Complete / Primary / Backup). Existing helpers: `StateWord`, `CommitBadge`, `AbsentWord`                                                               |
| A field's value in a cell                                                         | `FieldCell field=…` (finding-fields) or `TimeCell field=…` (page-kit) — never `fieldText(...) ?? "absent"`, which turns (empty) and unavailable into "absent"                                                                                                                                       |
| Unavailable, error, or warning state                                              | FF `Banner` (`status="error" \| "warning" \| "info"`, `contrast="high"` inline). It must include `BannerTitle` + `BannerDescription` with the reason. For a failed read with Retry, use `ErrorRows` from `list-states`                                                                              |
| Term that needs explaining                                                        | `Term label=… technical="Technical: …"` from `@/components/term`. For a custom trigger, use `TermTooltip` + `TermExplanation`. Use FF `Tooltip content=…` for short labels                                                                                                                          |
| Loading rows                                                                      | `ListBlock` for a whole list body; else `LoadingRows` or `Skeleton` (see Loading below)                                                                                                                                                                                                             |
| Keyboard caps                                                                     | `Kbd` from `ui/misc`                                                                                                                                                                                                                                                                                |
| Rendered prose or markdown                                                        | `.typeset` on the container                                                                                                                                                                                                                                                                         |

## Type: six roles, three weights, two colors

- **Size** every piece of text with a role:
  `typeClass("display" | "title" | "subtitle" | "body" | "caption" | "micro", "default" | "compact")`,
  or `useSize().type.<role>` so it follows the surrounding `SizeProvider`.
  Never write `text-[13px]` or `text-sm`, and never a bare `text-caption` in
  `cn()` (it gets dropped).
  - **display:** page title only, already rendered by the shell; the Overview
    masthead also uses it.
  - **title:** section headings and dialog or sheet titles.
  - **subtitle:** panel titles and emphasized rows.
  - **body:** text and table cells.
  - **caption:** meta, descriptions, labels, counts.
  - **micro:** key caps, counters, tiny badges.
  - Editable fields use `useSize().field`.
- **Weight** comes from `style={{ fontVariationSettings: fontWeights.normal | semibold | bold }}`.
  Use `semibold` for headings and selected items and `bold` only for display.
  **No `font-medium`, `font-semibold`, or `font-bold` classes.** For text that
  gets heavier when selected or active, use the ghost-span pattern
  (`WeightLabel` in page-kit is an example).
- **Color:** `text-foreground` and `text-muted-foreground` only (use
  `text-background` on an inverted fill). Red is allowed only for an error
  message. Never use an opacity step (`text-muted-foreground/60`). State hues
  go on dots, icons, and Badges, not on body text.
- **No `uppercase`, no `tracking-*`, no eyebrow labels** above titles. Build
  hierarchy from size and weight.
- Numbers use `tabular-nums`. Hashes, paths, IDs, and raw values use
  `font-mono` at the cell's role size.

## Spacing, radius, surfaces

- Stay on the size ladder: controls and rows are 36px (`h-9`), or 28px
  compact (`h-7`). Get gaps from `useSize().gap` (8px, or 4px compact) in
  toolbars and button clusters. Wrap a dense region (a filter bar, a table
  toolbar) in one `<SizeProvider size="compact">` rather than sizing each
  control.
- **Radii:** a panel is 12px (`shape.container` / `rounded-xl`). An element
  inset 4px inside it is 8px (`rounded-lg`). For any other inset, use
  `nestedRadius(12, inset)` from `@/lib/shape-context`. Badges and items use
  `shape.item`.
- **Surfaces:** don't hard-code `bg-card` or `bg-white` panels. Use `Panel`,
  or `Elevated offset={n}` for anything custom that floats: offset 2 for a
  popover (with `shadowLevel={3}`), 4 for a dialog. Hairlines are
  `border-border`.
- **Hover and selection fills** are `bg-hover` and `bg-active`, never ad-hoc
  greys.

## Motion

- Springs only: `import { spring } from "@/lib/springs"`.
  - `spring.fast`: hover, fades, indicators.
  - `spring.moderate`: short travel, panels that must land exactly.
  - `spring.slow`: dialogs and big surfaces.
  - Exits use `spring.X.exit`.
- Animate only `transform` and `opacity`. Reduced motion is handled by
  `FluidProvider` (MotionConfig) and the reveal CSS.
- **Custom hover lists** (a list, menu, strip, or grid you write yourself) use
  `useFluidHover(containerRef, { axis })` + `<FluidHoverHighlight hover={…} />`
  - `useRegisterFluidHoverItem` per row (see custom-motion.md). Never use
    per-row `hover:bg-*`. Only clickable rows register. Leave a list without
    fluid hover when a wrong click would hurt or only some rows are clickable.
- **Loading:** wrap the skeleton and the real block in `reveal-swap`, add the
  real block after the skeleton when data lands, and put `reveal-items` on
  both so the rows hand over one by one. Build each skeleton at the real
  block's size. Load each block on its own; never fake a sequence.

## Charts (Recharts)

Recharts writes colors as SVG attributes, which can't resolve `var()`. Get
resolved token values from `useChartTokens()` in `components/charts.tsx`; it
re-reads them when the theme flips. Add any token you need to its `TOKENS`
list. Every token in `app.css` is a plain color for this reason, so keep it
that way.

- **Series:** the main series is `--primary`. A neutral or secondary series is
  `--muted-foreground` or `--accent`. Evidence series use `--success`,
  `--destructive`, `--wal`, and `--violet`, always with a legend or label
  word.
- **Grid and axes:** `--border` for the grid. Ticks use `--muted-foreground`
  at the caption size (12px) in Inter: `tick={{ fontSize: 12, fill, fontFamily: "Inter" }}`.
  No axis lines.
- **Tooltip:** a custom `content` drawn as an FF surface. Either an
  `Elevated offset={2} shadowLevel={3}` box, `rounded-xl p-2`, with a caption
  label and body value, `tabular-nums`, or FF's inverted tooltip style
  (`bg-foreground text-background`, caption). Don't use Recharts' default box.
  Cursor fill: `--hover`.
- Turn off Recharts animation under reduced motion with
  `usePrefersReducedMotion()`. Otherwise keep it at or below 240ms.

Shared chart parts (`components/charts.tsx`, `components/chart-section.tsx`)
— use them instead of hand-writing the same Recharts props:

- `ChartSection({ title, description, action?, footer?, className, children })`:
  the chart's Panel (`role="region"`, labelled by its title); `action` sits
  in a compact SizeProvider on the right; `footer` is a `PanelFooter`.
- Props helpers, spread onto Recharts: `chartAxis(tokens)` (no axis line or
  tick marks, caption ticks), `chartGrid(tokens)` (one
  horizontal hairline grid), `chartAnimation(reduced)` (spring.slow's
  duration, off under reduced motion), `chartTooltipMotion(reduced)`.
- Tooltip: `ChartTooltipCard` + `ChartTooltipValue` + `ChartTooltipNote`.
- Bars: `FluidBandCursor`, `FluidBar`, `activeIndexOf`, `CHART_FOCUS_CLASS`.
- Ready charts: `ActivityBars` (count per day — visits on Overview,
  History and Timeline, last-used entries on Cache; `onSelectDay` /
  `range` + `onRangeChange`, a range with one bound set lights the
  open-ended span as the lists filter it; `unit={{ one, many }}`),
  `HourBars`, `CredentialAgeScatter`
  (recovered points as diamonds on `--wal`, or `--violet` with
  `sidecar: "journal"`). Empty: `ChartEmpty`.
- Day labels: `formatDay` ("4 Mar 2024") and `formatDayTick` ("4 Mar") and
  the shared `CHART_HEIGHT` come from page-kit.

## Forensic presentation rules (non-negotiable)

1. The **Completeness Statement** ("Evidence coverage") renders before any row
   on every evidence page.
2. **TYPE is the first column** of every evidence table.
3. **value / (empty) / absent / unavailable** are distinct words, never color
   alone. A Badge or dot only repeats the word.
4. **Sidecar rows** (WAL / rollback journal) are a **separate list** from
   committed rows. Never merge them into one table — the Timeline too splits
   its loaded stream into Saved and Recovered tabs, each in time order.
5. **No Candidate value on a tile.** Stat tiles show recorded facts only.
6. Read-only: no control may start ingest, analysis, or export.

## Theme

`theme.tsx` owns `<html data-theme="light|dark">`. Its `ThemeToggle` lives in
the sidebar footer. `dark:` variants follow `data-theme`. To screenshot a
mode, click the toggle, or set `localStorage["forensix.theme"]` to `"light"`,
`"dark"`, or `"system"` before load.

## Build and screenshot on your own port (parallel-safe)

Every agent builds into its own directory and serves it on its own port, so
nobody overwrites `dist/` or another agent's server:

```bash
cd client
export FORENSIX_CLIENT_OUTDIR=/tmp/fluid-ui/<you>/build   # or: node scripts/build.mjs --outdir <dir>
node scripts/build.mjs                                     # writes $FORENSIX_CLIENT_OUTDIR/index.js
node mock/server.mjs --port <your-port> &                  # serves that bundle (or --bundle <file>)
# watch mode instead: node scripts/mock-dev.mjs --port <your-port> --outdir <dir>
```

The mock reads the bundle fresh on every request, so rebuilding is enough. It
sends the real server's CSP, so a violation shows up in the browser console
here first. Run `pnpm --filter @forensix/client typecheck` before you hand
off.

Screenshots use the agent-browser skill
(`/Users/adamchmara/.agents/skills/agent-browser/SKILL.md`; run
`agent-browser skills get core` first). Always use your own session:

```bash
export AGENT_BROWSER_SESSION=fluid-<you>
agent-browser set viewport 1440 900          # also check 390 844 (drawer layout)
agent-browser open http://127.0.0.1:<your-port>/
agent-browser snapshot -i                     # find the nav button and theme tabs
agent-browser click @eN                       # e.g. "History", then the "Dark" tab
agent-browser screenshot /tmp/fluid-ui/<you>/<page>-<mode>.png
agent-browser close                           # when done
```

The screenshot file can land a moment after the command returns, so wait a
second before reading it. Popups and the drawer animate, so allow about
300ms after a click.

## Evidence coverage (forensic rule 1)

`CompletenessPanel` from `components/completeness.tsx`:

```tsx
<CompletenessPanel
  completeness={completeness} // the page's prop, from the shell
  artifacts={[config.completenessArtifact]} // keys from src/artifacts.ts
/>
```

- `artifacts` are Completeness artifact keys (`ArtifactConfig.completenessArtifact`:
  "History", "Cookies", "Login Data", "Top Sites", "Downloads", "Bookmarks",
  "Web Data", "Cache", "Favicons", "Preferences"). Omit it for the whole Case.
- More than one artifact: counts are summed, the artifacts are named under
  the title (plain labels), and the per-database table gains an Artifact
  column. Merged views use `TIMELINE_COVERAGE` (History, Downloads, Cookies,
  Web Data — what core's queryTimeline merges) and `SITES_COVERAGE` (History,
  Cookies, Login Data, Bookmarks, Top Sites, Web Data).
- An artifact in scope with no statement at all is listed as "Not analyzed".
- It renders first on the page, before any row or figure.

## The page kit (`components/page-kit.tsx`)

Shared presentation parts. Import from `./page-kit.js` (or
`@/components/page-kit`) instead of writing a local copy.

| Export                                                                                         | Use                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `formatBytes(n)`                                                                               | "1.4 MB" / "812 KB" / "312 B" (base-1024, one decimal below 100)                                                                                                                                                                                                                                                                 |
| `plural(n, one, many)`                                                                         | "1 visit" / "1,204 visits"                                                                                                                                                                                                                                                                                                       |
| `formatDay(yyyy-mm-dd)`, `formatDayTick(…)`                                                    | "4 Mar 2024", "4 Mar" (UTC)                                                                                                                                                                                                                                                                                                      |
| `CHART_HEIGHT`                                                                                 | `h-[220px]`, the over-time chart and its skeleton                                                                                                                                                                                                                                                                                |
| `TimeText({ field?, utc?, inheritType?, className? })`, `TimeCell({ field?, utc? })`           | A timestamp "9 Dec 2024 14:32:07" (time muted, UTC title). Pass the FieldState as `field` so non-values keep their word; `TimeCell` inherits the table cell's type                                                                                                                                                               |
| `Count({ children })`                                                                          | A count beside a title: caption, muted, tabular; numbers are grouped                                                                                                                                                                                                                                                             |
| `WeightLabel({ text, active })`                                                                | Semibold-when-active without reflow (ghost span), truncating                                                                                                                                                                                                                                                                     |
| `SectionPanel({ id?, title, headingAs?, description?, count?, aside?, className?, children })` | A Panel with `PanelHeader` (title, Count, description) and a trailing `aside`; `role="region"` + `aria-labelledby` when `id` is given                                                                                                                                                                                            |
| `Toolbar({ start?, children?, placement? })`                                                   | The list toolbar in one compact SizeProvider. `placement="panel"` (default): under the list's `PanelHeader`, `px-4 pt-1 pb-3`, `start` (the saved/recovered switch) left, `children` pushed right (FilterField + Select, ProfilePicker, `FilterTextField` last). `placement="inline"`: unpadded row for another container's slot |
| `IconTile({ icon })`                                                                           | 32px tinted tile with a muted icon                                                                                                                                                                                                                                                                                               |
| `MeterList({ rows: MeterRow[], tokens, labelWidth? })`                                         | Ranked horizontal bars: `--primary`, peak 1 / others 0.45, sliding on `spring.slow` (transform only)                                                                                                                                                                                                                             |
| `ShareBar({ fraction, peak?, className? })`                                                    | One share-of-peak pill, same grammar as MeterList (translateX)                                                                                                                                                                                                                                                                   |
| `CARD_TITLE_CLEAR`                                                                             | Class for an FF CardTitle that must stay on one line                                                                                                                                                                                                                                                                             |
| `CommitStateSplit`, `CommitView`, `splitByCommit`                                              | Saved / recovered (below)                                                                                                                                                                                                                                                                                                        |

Also shared: `FieldCell({ field, format?, truncate? })`, `fieldString`,
`fieldBool`, `fieldText`, `fieldUtc`, `fieldInteger`, `AbsentWord`,
`StateWord({ state, focusable? })`, `SiteAvatar` (finding-fields);
`FilterField`, `FilterTextField({ …, commit? })`, `ProfilePicker`
(filters); `EmptyRows`, `activateOnKey`, `ROW_FOCUS_CLASS` (data-table);
`ListBlock`, `RevealSwap`, `LoadingRows({ rows?, label? })`, `ErrorRows`,
`ListFooter` (list-states); `figure`, `PendingFigure`, `UnavailableFigure`
(metric-band); `useActivity`, `visitTotal`, `bucketsToDays`, `fillGaps`
(activity-data); `categoryOf`, `isPaymentField` (form-data);
`secretFieldsOf`, `SecretValueCell`, `HiddenValue` (row-sheet).
The readers (`fieldText` …) return `null` for absent, (empty) and
unavailable alike — use them to compute, and `FieldCell` / `TimeCell` to
show.

## Saved and recovered rows (forensic rule 4) — one pattern

Sidecar (WAL / rollback-journal) rows are always their own list, read as
their own server query (`commit-state=committed | wal_resident |
journal_resident` on every Finding route except `cache` and `timeline`;
the design mock honours it too).

```tsx
import { useCommitStateLists } from "../use-commit-state-lists.js";
import { CommitStateSplit, type CommitView } from "./page-kit.js";

const lists = useCommitStateLists<Finding>(config.route, parameters);
const [view, setView] = useState<CommitView>("saved");

<SectionPanel title="All cookies" description="…">
  <CommitStateSplit
    value={view}
    onValueChange={setView}
    label="Saved or recovered cookies"
    savedCount={lists.saved.loading && lists.saved.rows.length === 0 ? null : lists.saved.rows.length}
    recoveredCount={lists.recovered.loading && lists.recovered.rows.length === 0 ? null : lists.recovered.rows.length}
    savedMore={lists.saved.cursor !== null}
    recoveredMore={lists.recovered.cursor !== null}
    toolbar={<FilterTextField commit="change" … />}
    saved={<CookieTable list={lists.saved} />}
    recovered={<CookieTable list={lists.recovered} />}
  />
</SectionPanel>
```

- `useCommitStateLists<Row>(route, parameters, { enabled?, drain? })`
  returns `{ saved, recovered, drained }`, each list a `PaginatedList`
  (`rows`, `cursor`, `loading`, `error`, `loadMore`, `retry`).
  `recovered.rows` is the WAL list then the journal list (never
  interleaved); `recovered.loadMore` drains WAL first; `recovered.wal` /
  `recovered.journal` are the two underlying reads.
- `retry` re-reads only what failed (`usePaginatedList`): after a failed
  "Load more" it asks for that page again and keeps the loaded rows; the
  recovered list retries only its failed half.
- `drain: <row cap>` follows every page (per read) so figures cover the
  whole set; `drained.saved` / `drained.recovered` say when each settled.
- `ListBlock({ list, noun: { one, many }, shown?, filtered?, onClearFilters?, empty, children })`
  (list-states) is the body of one list: skeleton → rows (`RevealSwap`),
  failed first read, empty or filtered-empty ("Clear filters"), load-more
  error, `ListFooter`. Pass it as `saved` / `recovered`.
- `CommitStateSplit` `variant="tabs"` (default) is for every full artifact
  table: the FF Tabs switch "Saved N" · "Recovered N" (`+` while more pages
  stand) on the left of a `Toolbar`, `toolbar` controls on the right, a
  hairline, then the active list. Controlled (`value` + `onValueChange`) or
  uncontrolled (`defaultValue`).
- `variant="stacked"` only for a small embedded table (the Sites
  drill-down): the saved list, then — only when there are recovered rows —
  a "Recovered N" sub-heading (`headingAs`, default `h3`) and the
  recovered list.
- Figures that count rows (tiles, leaderboards, charts) count the saved list
  unless they are explicitly about recovered rows; never sum the two into
  one figure without saying so.
- Cache's route cannot filter by Commit State, so Cache splits its loaded
  page with `splitByCommit(rows)` → `{ saved, recovered }` and still shows
  two lists. The Timeline route can't either: it splits its loaded stream
  the same way into Saved / Recovered tabs, each still in time order.
- Activity (visits per day / hour): `useActivity()` / `fetchActivity()`
  (activity-data) return `{ saved, recovered, complete }` buckets; charts
  and figures draw `saved`, and recovered visits are named beside them
  ("N recovered not counted"), never summed in.

## Secrets: hidden by default

Values that are secrets (cookie values, Payment-category form data) read
"value hidden" in tables until a page-level "Show values" `Switch` is on,
and in the row sheet until revealed there:
`<RowSheet selected={…} onClose={…} redactedFields={secretFieldsOf(row)} />`.
Each named field that holds a recorded, non-empty value opens hidden with a
Reveal / Hide button; (empty), absent and unavailable still show as words.

- `form-data.ts`: the Form data category rule (`categoryOf`,
  `FORM_DATA_CATEGORIES`, Payment first) and `isPaymentField(name)`.
- `row-sheet.tsx`: `secretFieldsOf(row)` (a cookie's `value`, a Payment
  entry's `fieldValue` / `fieldValueLower`), `SecretValueCell({ field,
reveal })` and `HiddenValue` for table cells.
- Form data, Cookies and the Timeline (once a Payment row is loaded) carry
  the "Show values" Switch; the Sites drill-down hides Payment values with
  the sheet as the reveal.

## MetricBand tone

`MetricBandItem tone` colours the progress fill and, beside the item's
`status` word, a state dot. It never shows on its own: without `status`
or `progress`, `tone` draws nothing. Write `tone="warning" status="recovered"`.

A figure that is not yet a number: `figure(read, show)` with a
`Read<T>` (`loading` → `PendingFigure` skeleton, `failed` →
`UnavailableFigure` "unavailable" + dot) — never a "0" or a dash. Below
`sm` the label, status word and detail wrap instead of truncating.

## Canonical patterns (one winner per repeated need)

| Need                       | Use                                                                                                                                                                                                                                            | Not                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Section with a header      | page-kit `SectionPanel` (`PanelHeader` + `PanelTitle` subtitle + `PanelDescription` body + caption `Count` + `aside`, `role="region"`, `aria-labelledby`)                                                                                      | local SectionPanel / WidgetPanel / hand-built `<h2>` headers              |
| Chart panel                | `ChartSection` (+ `footer`), body `px-2 pt-2 pb-3`, Recharts via the charts.tsx helpers                                                                                                                                                        | hand-built chart Panels, own tooltips, hand durations                     |
| Visits per day             | `ActivityBars` everywhere                                                                                                                                                                                                                      | a copied `BarChart`                                                       |
| Figure strip               | `MetricBand grid-cols-2 lg:grid-cols-4`, title-role figures, `detail` on every item                                                                                                                                                            | hand-built `<dl>` strips, `display`-size figures, `xl:`/`sm:` breakpoints |
| Toolbar                    | page-kit `Toolbar` under the list's `PanelHeader` (compact, `px-4 pt-1 pb-3`): the saved/recovered switch left, then `ml-auto` filters (`FilterField` + `Select`, `ProfilePicker`), `FilterTextField` (`w-60`) last                            | filter chips in the header action                                         |
| Search                     | `FilterTextField`: `commit="change"` for client-side filters, default Enter/blur for server queries                                                                                                                                            | raw `InputGroup`                                                          |
| Profile filter             | `ProfilePicker` (multi-pick)                                                                                                                                                                                                                   | `TabsSubtle` per profile                                                  |
| Table                      | FF `Table` in `scroll-fade-x overflow-x-auto px-1 py-1 [&_tbody>tr:last-child]:border-transparent`; `TableRow index tabIndex aria-label` + `ROW_FOCUS_CLASS`; `reveal-items` on the body only inside `reveal-swap`; first column header "Type" | `px-2` row insets                                                         |
| List body + footer         | `ListBlock` (its `ListFooter`)                                                                                                                                                                                                                 | hand-built footers                                                        |
| Commit State mark          | `StateWord` in cells (no own tab stop in a focusable row), `CommitBadge` in the sheet header                                                                                                                                                   | hand-rolled dots                                                          |
| Other state marks          | `EvidenceDot` + word, hue matching the word (warning for expired / failed, neutral for complete / backup)                                                                                                                                      | a state hue borrowed for a different meaning                              |
| Non-state labels           | plain `Badge`, no dot                                                                                                                                                                                                                          | grey-dot Badges                                                           |
| Ranked bars                | page-kit `MeterList` / `ShareBar`                                                                                                                                                                                                              | `bg-foreground opacity-*` bars                                            |
| Clickable list             | FF `CardGroup` for entities, or `useFluidHover` + `h-9` button rows + `WeightLabel` + `bg-active` when selected                                                                                                                                | `py-2` / `py-2.5` / `h-8` rows                                            |
| Empty                      | `EmptyRows` (icon + title + message when the page is empty; message + tertiary "Clear filters" when filtered); `ChartEmpty` in charts                                                                                                          | plain `<p>` empties                                                       |
| Error                      | `ErrorRows` (title ends with "."), also for load-more                                                                                                                                                                                          | captions in `text-destructive`                                            |
| Loading                    | `reveal-swap` with a skeleton the size of the real block (`LoadingRows` for tables), `role="status"` + `aria-label`                                                                                                                            | ternary swaps, `aria-hidden` skeletons                                    |
| Page root                  | `flex flex-col gap-5`; grids `gap-4`                                                                                                                                                                                                           | `gap-4` / `gap-6` roots                                                   |
| Row sheet title            | the recorded name, else a kind noun ("Cookie", "Download")                                                                                                                                                                                     | invented words                                                            |
| Values that can't be shown | words ("absent", "unavailable", "not recorded"), never "—"                                                                                                                                                                                     | dashes                                                                    |

## Legacy CSS (removed)

The compat shims (`components/compat/*`), `stat-tile.tsx`,
`artifact-page.tsx` (with the dead `FindingsTable`, `FilterBar`,
`ListCard`), `cache-kit.tsx` (now page-kit) and `history-coverage.tsx` are
gone, and so are the legacy classes `.fx-hero`, `.fx-rise`,
`.metric-band-*`, `.fx-scroll-x` and the legacy tokens
(`primary-foreground`, `accent-border`, `inverse`, `edge-shadow`, and the
`bg-primary` / `text-primary` utility aliases). `--primary` stays as the
main chart series token, read through `useChartTokens` (or
`var(--primary)` in a style). `ui/misc.tsx` keeps only `Skeleton`; its
legacy `Input`, `SelectNative`, `Chip`, `Labeled` and `Kbd` are gone (use FF
`InputGroup`, `Select`, `CheckboxGroup`). `ChartToggle`, `ChartLegend`
(now internal), `CoverageDial` and `SectionHeading` were removed as unused.

The per-page `*-wash` and `*-border` evidence tokens (`bg-wal-wash`,
`border-destructive-border`, …) remain valid. They are derived from the state
hues. Prefer `EvidenceBadge`, `EvidenceDot`, and `Banner`, which already use
them correctly.
