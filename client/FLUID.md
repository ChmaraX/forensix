# Fluid Functionalism in the ForensiX client

Every page uses [Fluid Functionalism](https://www.fluidfunctionalism.com) (FF):
its components, its motion system, and its look. This file covers how to do
that here. For the system itself, read the FF skill in this order:
`~/.agents/skills/fluid-functionalism/SKILL.md`, then
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
  `node ~/.agents/skills/fluid-functionalism/scripts/upgrade.mjs client`
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

## Declutter rules (every page)

The decluttered pages follow these; keep new work to them.

- **No page subtitles.** A page has its H1 only (Overview: the subject
  name and its identity line).
- **A description only when it adds information** the title does not
  carry. `SectionPanel` and `ChartSection` take `description` optionally;
  the default is none. No how-to-use copy: the control's affordance does
  that job.
- **Numbers speak without captions.** A figure tile is label + value; a
  sub-line (`detail`) only when it is data itself (a date span "4 Mar -
  17 Apr", "across 7 sized rows"). "N of M" belongs in the value's tooltip.
- **At most one figure strip per page, at most four tiles,** and at most
  one or two widgets. A widget is never a re-sort of the table, never
  degenerate on real data (one bar, all ones), never an inference.
- **One chart style** (see "Charts"), including the per-day charts driving
  the page's date range.
- **Charts count saved rows** without saying so (no "Saved only" tag);
  the Recovered tab says what recovered rows are (its tooltip).
- **List footer:** only while the list is paged or a client-side filter
  hides rows: "3 of 22", "50 of 50+" with Load more (`ListFooter`). Never
  "22 saved X shown".
- **State column:** only in the Recovered tab (it separates unsaved from
  overwritten); the Saved tab has none, every row there is saved.
- **Monospace only for code-like values** (URLs, paths, ids, hashes,
  cookie names); see "Type".
- **One control height in a panel:** 28px (compact) for every header and
  toolbar control.
- **Plain hyphens in copy:** user-visible text uses "-" (" - " between
  phrases, "6-10 Apr" in a range), never an em or en dash.

## What is installed

| Area                               | Files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Components (`src/components/ui/`)  | accordion, badge, banner, button, card, checkbox-group, combobox, command-menu, dialog, dropdown (+ dropdown-search, dropdown-sub, menu-item), input-copy, input-group, mobile-drawer, radio-group, scroll-area, select, sidebar (+ sidebar-core, sidebar-menu), skeleton, slider, switch, table, tabs, tabs-subtle, tooltip                                                                                                                                                                                                                                       |
| Systems (`src/lib/`, `src/hooks/`) | springs, font-weight, size-context, type-scale, shape-context, surface-context, surface-classes, elevated, icon-context, icons-untitledui, popup, omit, utils (`cn`), fluid-provider, sidebar-menu-grid; hooks: use-fluid-hover, use-merge-split, use-keyboard-nav-gate, use-touch-primary; `src/components/fluid-hover-highlight.tsx`                                                                                                                                                                                                                             |
| CSS (`src/app.css`)                | FF tokens, the surface and shadow ladders, the type scale, `.typeset`, native scrollbars, `scroll-fade` / `scroll-fade-x` / `scroll-divider`, and `reveal-*`                                                                                                                                                                                                                                                                                                                                                                                                       |
| Block                              | `src/components/sidebar-app/*` (App Sidebar: `inset-topbar`, `search-field`, `user-footer`, `workspace-header`). The block's demo assembly (`app-sidebar.tsx`, `nav-data.ts`) was removed as unused; the real shell lives in `src/app.tsx`.                                                                                                                                                                                                                                                                                                                        |
| Built on FF here                   | `ui/popover.tsx`, `ui/sheet.tsx`, `ui/misc.tsx` (Skeleton), `components/panel.tsx`, `components/evidence.tsx`, `components/term.tsx`, `components/list-states.tsx`, `components/page-kit.tsx` (see "The page kit"), `components/responsive-rows.tsx`, `lib/app-icons.ts` (see "Icons"), `components/completeness.tsx`, `components/row-sheet.tsx`, `components/form-data.ts`, `components/metric-band.tsx`, `components/activity-data.ts`, `components/day-bounds.ts`, `components/secrets.ts`, `components/charts.tsx` + `charts-ready.tsx` + `chart-section.tsx` |

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
- The page header is the shell's: the page title alone (no description
  line) and, at the right of the title row, the page's coverage indicator.
  When something in the page's scope was not read, the coverage banner
  sits directly under the header, above your page. Pages render no
  coverage of their own (see "Evidence coverage"). Overview builds its own
  masthead; the shell hands it a quiet whole-Case indicator for the
  masthead's right (`OverviewPage coverage`) and **no banner**.
- Icons are Untitled UI: `FluidProvider icons={untitleduiIcons}` swaps every
  FF component glyph, and app code imports its own icons by role from
  `@/lib/app-icons` (see "Icons"). Never import `lucide-react` in new code.
- The column provides **surface level 2**. A `Panel` lands on surface 3, and
  popups and dialogs open from there and walk further up the ladder on their
  own.
- Pages start at the top of the page. The document scrolls, not the inset, so
  sticky elements stick to the viewport.

## Which component for which need

| Dashboard need                                                                    | Use                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Framed section (stat band, chart, table card)                                     | `SectionPanel` from page-kit (or the raw `Panel`, `PanelHeader`, `PanelTitle`, `PanelDescription`, `PanelFooter` from `@/components/panel` when it doesn't fit). Heading level: `PanelTitle as="h3"` / `SectionPanel headingAs`, never `role="heading"`                                                                                                                  |
| Chart panel                                                                       | `ChartSection` (`action` for a control, `footer` for a note, `description` only when it adds information)                                                                                                                                                                                                                                                                |
| Saved vs recovered rows                                                           | `useCommitStateLists` + `CommitStateSplit` (see "Saved and recovered rows")                                                                                                                                                                                                                                                                                              |
| Clickable card grid or list (e.g. Top sites tiles)                                | FF `CardGroup` + `Card` (`columns` > 1 gives 2-D fluid hover). Its cards are transparent on purpose, so put the group inside a Panel if it needs a frame                                                                                                                                                                                                                 |
| Evidence table                                                                    | FF `Table`, `TableHeader`, `TableBody`, `TableRow index={i}` (body rows only), `TableHead`, `TableCell`. Rows sit on the 36px ladder, or 28px with `size="compact"`. **TYPE is the first column.** Render it through page-kit `ResponsiveRows` so a phone gets stacked row cards (TYPE / time and State stay on the first line); it adds `scroll-fade-x` on the scroller |
| Row detail side panel                                                             | `RowSheet` from `components/row-sheet` (built on `Sheet`; `redactedFields` hides secrets until revealed). Raw `Sheet` + `SheetContent` (+ `SheetHeader`, `SheetTitle`, `SheetDescription`, `SheetBody`, `SheetFooter`) only for a non-row sheet                                                                                                                          |
| Modal                                                                             | FF `Dialog` (`size` sm, lg, or xl)                                                                                                                                                                                                                                                                                                                                       |
| Single-choice filter (sort, transition, profile)                                  | FF `Select` (`SelectTrigger`, `SelectContent`, `SelectItem index value`). `size="compact"` in filter bars                                                                                                                                                                                                                                                                |
| Searchable, multi-pick, or create filter                                          | FF `Combobox`                                                                                                                                                                                                                                                                                                                                                            |
| Text search field                                                                 | FF `InputGroup` + `InputField` (with `labelHidden` and the `search` icon for a toolbar search). `misc.Input` is only for legacy forms                                                                                                                                                                                                                                    |
| Segmented control (2-4 mutually exclusive views, e.g. newest/oldest, bytes/count) | FF `Tabs` + `TabsList` + `TabItem` (`size="compact"` in a toolbar); `CommitStateSplit` for saved/recovered                                                                                                                                                                                                                                                               |
| Tab navigation inside a page (e.g. per-profile sections)                          | FF `TabsSubtle` + `TabsSubtleItem`                                                                                                                                                                                                                                                                                                                                       |
| Multi-select toggles (profiles)                                                   | FF `CheckboxGroup` in a popover or panel (`ProfilePicker`)                                                                                                                                                                                                                                                                                                               |
| One-of chip filter with counts (event types, form categories)                     | page-kit `CountChips` in the list `Toolbar`'s trailing controls: "All N" then "Label N" (count muted, tabular), fluid hover, wraps from `sm`, scrolls (no scrollbar) below                                                                                                                                                                                               |
| Actions menu or "more"                                                            | FF `DropdownMenu`, `DropdownTrigger`, `DropdownContent`, `MenuItem`                                                                                                                                                                                                                                                                                                      |
| Anchored panel (date range calendar, etc.)                                        | `Popover`, `PopoverTrigger`, `PopoverContent` from `@/components/ui/popover` (`flush` drops the 4px padding)                                                                                                                                                                                                                                                             |
| Copy a hash, path, or URL                                                         | FF `InputCopy`                                                                                                                                                                                                                                                                                                                                                           |
| Show/hide details                                                                 | FF `Accordion`                                                                                                                                                                                                                                                                                                                                                           |
| Toggle a setting                                                                  | FF `Switch`                                                                                                                                                                                                                                                                                                                                                              |
| Jump-to / ⌘K                                                                      | FF `CommandMenuDialog`                                                                                                                                                                                                                                                                                                                                                   |
| Buttons                                                                           | FF `Button`: `primary` for the one main action, `secondary` for ordinary actions, `tertiary` for bordered or quiet actions ("Load more"), `ghost` for icon and toolbar buttons. Sizes: default 36px, `compact` 28px, `icon` / `icon-compact`. Use the `loading` prop rather than swapping the label                                                                      |
| Evidence-state chip                                                               | `EvidenceBadge state="produced \| unavailable \| absent \| empty \| committed \| wal \| journal \| warning"` with the **state word as its children**                                                                                                                                                                                                                     |
| State word in a cell or text                                                      | `EvidenceDot state=…` + the word on `text-foreground` or `text-muted-foreground` (`state="neutral"`, a hollow ring, for plain labels such as Complete / Primary / Backup). Existing helpers: `StateWord`, `CommitBadge`, `AbsentWord`                                                                                                                                    |
| A field's value in a cell                                                         | `FieldCell field=…` (finding-fields) or `TimeCell field=…` (page-kit) - never `fieldText(...) ?? "absent"`, which turns (empty) and unavailable into "absent"                                                                                                                                                                                                            |
| Unavailable, error, or warning state                                              | FF `Banner` (`status="error" \| "warning" \| "info"`, `contrast="high"` inline). It must include `BannerTitle` + `BannerDescription` with the reason (the shell's one-line `CoverageBanner` carries its reason in the title). For a failed read with Retry, use `ErrorRows` from `list-states`                                                                           |
| Term that needs explaining                                                        | `Term label=… technical="Technical: …"` from `@/components/term`. For a custom trigger, use `TermTooltip` + `TermExplanation`. Use FF `Tooltip content=…` for short labels                                                                                                                                                                                               |
| Loading rows                                                                      | `ListBlock` for a whole list body; else `LoadingRows` or `Skeleton` (see Loading below)                                                                                                                                                                                                                                                                                  |
| Rendered prose or markdown                                                        | `.typeset` on the container                                                                                                                                                                                                                                                                                                                                              |

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
- Numbers use `tabular-nums`.
- **Monospace only for code-like values:** URLs, file paths, hashes, raw
  keys and ids, hex, JSON - values someone copies or compares character by
  character. Never for names, hostnames (as headings or in cells), locales,
  booleans, counts, or dates. `FieldCell` / `FieldStateText` decide per
  value (`mono="auto"`, the default, via `isCodeLike`); pin a column with
  `mono` (URL, path) or `mono={false}`. Outside a field, use
  `codeClass(text)` (→ `"font-mono"` or `""`) or a literal `font-mono` on a
  column you know is code. Monospace sits at the cell's role size.

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

- **One series style, every chart** (`SERIES`, `seriesColor`,
  `seriesOpacity`, `SeriesBar`, `chartRange` in charts.tsx):
  - the series is ink, `--foreground` (`seriesColor(tokens)`), in light and
    dark alike - FF's palette is neutral, so a chart belongs to the page
    instead of shouting in blue;
  - every bar rests at `SERIES.rest` (0.3); **exactly one emphasis** at full
    ink: the selection when there is one, else the peak (ties share it).
    Never a second colour or an outline for "selected";
  - outside an active range, bars dim to `SERIES.dimmed`; the range itself
    is a `chartRange(tokens)` wash (ink at 0.06) behind the bars;
  - hover lifts the bar under the pointer (`FluidBar`, `spring.fast`);
  - **a zero draws nothing** - no `minPointSize`, no 1px stub;
  - integer counts are bars (or a `type="step"` line), never `monotone`
    curves or smoothed areas: they invent values between buckets;
  - evidence series keep their hue (`--wal`, `--violet`, `--success`,
    `--destructive`), always with a legend or label word. There is no
    `--primary` token.
  - Ranked bars (`ShareBar`) follow the same rule: ink, peak full, the
    rest at rest.
  - A categorical distribution (Cookies' lifespans) is one `SegmentBar`:
    neutral ordinal shades of ink, zero categories left out.
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

- use them instead of hand-writing the same Recharts props:

- Series: `seriesColor(tokens)`, `seriesOpacity({ emphasis, dimmed? })`,
  `SERIES`, `chartRange(tokens)` (spread onto `ReferenceArea`), and
  `SeriesBar` for a Bar `shape`:
  `shape={(p: BarShapeProps) => <SeriesBar {...p} tokens={tokens} emphasis={…} hovered={p.originalDataIndex === hoverIndex} />}`.
- `ChartSection({ title, description?, action?, footer?, className, children })`:
  the chart's Panel (`role="region"`, labelled by its title); `action` sits
  in a compact SizeProvider on the right; `footer` is a `PanelFooter`.
- Props helpers, spread onto Recharts: `chartAxis(tokens)` (no axis line or
  tick marks, caption ticks), `chartGrid(tokens)` (one
  horizontal hairline grid), `chartAnimation(reduced)` (spring.slow's
  duration, off under reduced motion), `chartTooltipMotion(reduced)`.
- Tooltip: `ChartTooltipCard` + `ChartTooltipValue` + `ChartTooltipNote`.
- Bars: `FluidBandCursor`, `FluidBar`, `activeIndexOf`, `CHART_FOCUS_CLASS`.
- Ready charts (`components/charts-ready.tsx`; the parts above stay in
  `charts.tsx`): `ActivityBars({ days, tokens, range?, onRangeChange?,
unit?, emptyMessage? })` (count per day: visits on Overview, History and
  Timeline, last-used entries on Cache), `HourBars` (read-only),
  `SegmentBar({ segments, tokens, unit, label? })` (a proportion bar with
  its legend; hover = fluid highlight + tooltip). Empty: `ChartEmpty`.
- **Per-day charts drive the page's date range**, the same value as the
  date picker beside them (Overview's masthead picker, History, Timeline,
  Downloads, Cache): click a day = that day; click it again (or the
  picker's clear) = the full span; drag across days = that span. Every
  figure, widget and list on the page follows the range; the chart keeps
  drawing every day, the range washed in and the days outside dimmed, the
  picked days at full ink. Pointer cursor, fluid hover band. A day is
  picked on pointer-up (press and release on one day), never on `click`:
  the press re-renders the bars, so a `click` on the bar itself would never
  fire. A count axis with a peak of 1-4 stops at `max(peak, 2)` with one
  tick per whole count. Pass `range`
  - `onRangeChange` to `ActivityBars`; Downloads' bytes chart follows the
    same rule by hand.
- Day labels: `formatDay` ("4 Mar 2024"), `formatDayTick` ("4 Mar"),
  `formatDaySpan` ("11 Mar - 17 Apr") and the shared `CHART_HEIGHT` come
  from page-kit. The cleared range reads "All recorded days" on every
  picker.
- **Days are Case days.** Core buckets activity in the Analysis Run's
  declared timezone (`analyse --timezone`), and every `history`
  `view=activity` row carries it (`fields.declaredTimezone`);
  `fetchActivity()` returns it as `timeZone` (null when the rows carry none
  or disagree). A picked range goes to the server through
  `dayRangeParameters(range, timeZone)` (`components/day-bounds.ts`): the
  first and last instant of those days on the Case's clock, so clicking
  day D lists exactly day D. `localDayOf(utc, timeZone)` reads a loaded
  row's day the same way. With no single declared timezone the bounds fall
  back to UTC days. Times in tables stay UTC (their header says so).

## Forensic presentation rules (non-negotiable)

1. The **Completeness Statement** ("Evidence coverage") is visible before any
   row on every evidence page: the shell's indicator in the title row, plus
   a banner above the page whenever anything in scope was not read.
2. **TYPE is the first column** of every evidence table.
3. **value / (empty) / absent / unavailable** are distinct words, never color
   alone. A Badge or dot only repeats the word.
4. **Sidecar rows** (WAL / rollback journal) are a **separate list** from
   committed rows. Never merge them into one table - the Timeline too splits
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

The shell owns it (`components/completeness.tsx`); pages render nothing.

- **`CoverageIndicator({ completeness, artifacts?, quiet?, className? })`** - a
  quiet ghost control at the right of the page title row: a state dot and
  "N/M read" (databases read of those attempted). Green dot when every
  database in scope was read, amber when something is not present or not
  analyzed, red when anything is unreadable. It opens an FF popover with the
  per-database detail: outcome word (dot repeats it), database file (mono),
  and the reason; grouped by artifact when more than one is in scope, unread
  databases first.
- **`CoverageBanner({ completeness, artifacts?, className? })`** - renders
  only when something in scope was not read: one line in an FF Banner
  (`error` when anything is unreadable, else `warning`; compact, low
  contrast) naming what - "Cookies could not be read - Database locked.",
  "No Form data database in Profile 3 (Guest) - …", or "Not everything was
  read: History in Profile 2, Cookies." - with a "Details" action opening
  the same detail. Healthy coverage: no banner, no panel.
- Scope: `artifacts` are Completeness artifact keys from `src/artifacts.ts`
  (`ArtifactConfig.completenessArtifact`: "History", "Cookies", "Login
  Data", "Top Sites", "Downloads", "Bookmarks", "Web Data", "Cache",
  "Favicons", "Preferences"); merged views use `TIMELINE_COVERAGE` (History,
  Downloads, Cookies, Web Data - what core's queryTimeline merges) and
  `SITES_COVERAGE` (History, Cookies, Login Data, Bookmarks, Top Sites, Web
  Data). Omit it for the whole Case. The shell picks the scope from the nav
  target (`coverageScopeOf` in app.tsx).
- An artifact in scope with no statement at all counts as "not analyzed"
  and raises the banner - never silently dropped.
- Overview: the indicator for the whole Case at the right of the masthead,
  `quiet` (a neutral ring unless something in the Case is unreadable, then
  red), and no banner: the landing page stays calm.
- A single-artifact page whose every database is unreadable shows the
  shell's "No rows to show: no Cookies database could be read." panel
  instead of the page (`UnreadPage` in app.tsx), never an empty state that
  reads as an absence.
- Per-database backend / format details (Cache "simple · format 8.0") are
  not in the popover: they live on the Cache rows, not in the
  Completeness Statement the shell holds.
- Also exported: `coverageOf(completeness, artifacts?)` (the summed
  `CoverageScope`), `CoverageDetail({ scope })`, `artifactLabel(key)`.
- Design the degraded states against the mock: open `/?degraded=1` (or start
  it with `--degraded`) - see `mock/README.md`. The mock keeps its data
  consistent with it: a database that was not read serves no rows.

## Icons

Untitled UI everywhere, as on the FF docs site. `FluidProvider
icons={untitleduiIcons}` (`src/lib/icons-untitledui.tsx`, a registry file)
makes every FF component draw Untitled UI. App code imports its own icons by
role from `src/lib/app-icons.ts` - `ARTIFACT_ICONS[key]` for each nav
section (also for a page's `IconTile` / `EmptyRows icon`), plus
`SearchIcon`, `RefreshIcon`, `ExternalLinkIcon`, `CloseIcon`,
`Chevron*Icon`, `ShowIcon` / `HideIcon`, `SortNewestIcon` /
`SortOldestIcon`, theme, state, and `FILE_KIND_ICONS`. Add a role there
rather than importing a glyph in a page. Icon props take the
`AppIcon` (= FF `IconComponent`) type. They are inline SVG components, so
the CSP is untouched.

## The page kit (`components/page-kit.tsx`)

Shared presentation parts. Import from `./page-kit.js` (or
`@/components/page-kit`) instead of writing a local copy.

| Export                                                                                                 | Use                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `formatBytes(n)`                                                                                       | "1.4 MB" / "812 KB" / "312 B" (base-1024, one decimal below 100)                                                                                                                                                                                                                                                                                                                                                                                                   |
| `plural(n, one, many)`                                                                                 | "1 visit" / "1,204 visits"                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `formatDay(yyyy-mm-dd)`, `formatDayTick(…)`                                                            | "4 Mar 2024", "4 Mar" (UTC)                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `CHART_HEIGHT`                                                                                         | `h-[220px]`, the over-time chart and its skeleton                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `TimeText({ field?, utc?, inheritType?, className? })`, `TimeCell({ field?, utc? })`                   | A timestamp "9 Dec 2024 14:32:07" (time muted, UTC title). Pass the FieldState as `field` so non-values keep their word; `TimeCell` inherits the table cell's type                                                                                                                                                                                                                                                                                                 |
| `Count({ children })`                                                                                  | A count beside a title: caption, muted, tabular; numbers are grouped                                                                                                                                                                                                                                                                                                                                                                                               |
| `WeightLabel({ text, active })`                                                                        | Semibold-when-active without reflow (ghost span), truncating                                                                                                                                                                                                                                                                                                                                                                                                       |
| `ResponsiveRows({ rows, columns: RowColumn[], rowKey, onSelect?, rowLabel?, tableClassName?, size? })` | An evidence list: FF Table from `sm` up, stacked row cards below (390px). Each column has `header` (a string, or a node such as a `Term` whose tooltip explains the values; then `label` gives the card its words), `cell`, `className`, and a card role `stack`: `lead` (first line left - TYPE or time), `aside` (first line right - State), `title`, `meta` (default; caption line, `labelled` adds the header), `hidden`. Reference: History's `VISIT_COLUMNS` |
| `SectionPanel({ id?, title, headingAs?, description?, count?, aside?, className?, children })`         | A Panel with `PanelHeader` (title, Count, description) and a trailing `aside` (compact, 28px); `role="region"` + `aria-labelledby` when `id` is given                                                                                                                                                                                                                                                                                                              |
| `Toolbar({ start?, children?, placement? })`                                                           | The list toolbar in one compact SizeProvider. `placement="panel"` (default): under the list's `PanelHeader`, `px-4 pt-1 pb-3`, `start` (the saved/recovered switch) left, `children` pushed right (FilterField + Select, ProfilePicker, `FilterTextField` last). `placement="inline"`: unpadded row for another container's slot                                                                                                                                   |
| `IconTile({ icon })`                                                                                   | 32px tinted tile with a muted icon                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `ShareBar({ fraction, peak?, className? })`                                                            | One share-of-peak pill in the series style: ink, peak full / others at rest (translateX)                                                                                                                                                                                                                                                                                                                                                                           |
| `CountChips({ label, allLabel?, total, chips, active, onChange })`                                     | The one chip filter with counts (Timeline event types, Form data categories): FF parts, 28px pills, muted tabular counts, fluid hover on both axes; wraps from `sm`, scrolls sideways with no scrollbar (`scroll-fade-x`) below                                                                                                                                                                                                                                    |
| `formatDaySpan(first, last)`                                                                           | "11 Mar - 17 Apr" (one year), "9 Dec 2023 - 4 Jan 2024", "4 Mar 2024" (one day): a span as figure data                                                                                                                                                                                                                                                                                                                                                             |
| `CARD_TITLE_CLEAR`                                                                                     | Class for an FF CardTitle that must stay on one line                                                                                                                                                                                                                                                                                                                                                                                                               |
| `CommitStateSplit`, `CommitView`, `splitByCommit`                                                      | Saved / recovered (below)                                                                                                                                                                                                                                                                                                                                                                                                                                          |

Also shared: `FieldCell({ field, format?, truncate?, mono? })`,
`TwoLineCell({ primary, secondary?, mono?, avatar? })` (the one two-line
cell: a name, title or host over its URL / path / realm, the second line
muted, compact and mono; `avatar` adds a `SiteAvatar`),
`isCodeLike`, `codeClass`, `profileLabel` ("Default" → "Default profile",
"Profile 2" stays - never print "Profile " before it), `fieldString`,
`fieldBool`, `fieldText`, `fieldUtc`, `fieldInteger`, `AbsentWord`,
`StateWord({ state, focusable? })`, `SiteAvatar` (finding-fields);
`FilterField`, `FilterTextField({ …, commit? })`, `ProfilePicker`
(filters); `EmptyRows`, `activateOnKey`, `ROW_FOCUS_CLASS` (data-table);
`ListBlock`, `RevealSwap`, `LoadingRows({ rows?, label? })`, `ErrorRows`,
`ListFooter` (list-states); `figure`, `PendingFigure`, `UnavailableFigure`
(metric-band); `useActivity`, `bucketsToDays`, `bucketsToHourTotals`, `fillGaps`
(activity-data); `categoryOf`, `isPaymentField` (form-data);
`secretFieldsOf`, `SecretValueCell`, `HiddenValue` (row-sheet);
`TooltipFigure` (metric-band); `dayRangeParameters`, `localDayOf`
(day-bounds).
The readers (`fieldText` …) return `null` for absent, (empty) and
unavailable alike - use them to compute, and `FieldCell` / `TimeCell` to
show.

## Saved and recovered rows (forensic rule 4) - one pattern

Sidecar (WAL / rollback-journal) rows are always their own list, read as
their own server query (`commit-state=committed | wal_resident |
journal_resident` on every Finding route except `cache` and `timeline`;
the design mock honours it too).

```tsx
import { useCommitStateLists } from "../use-commit-state-lists.js";
import { CommitStateSplit, type CommitView } from "./page-kit.js";

const lists = useCommitStateLists<Finding>(config.route, parameters);
const [view, setView] = useState<CommitView>("saved");

<SectionPanel title="All cookies">
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
- `ListBlock({ list, noun: { one, many }, shown?, filtered?, onClearFilters?, empty, total?, children })`
  (list-states) is the body of one list: skeleton → rows (`RevealSwap`),
  failed first read, empty or filtered-empty ("Clear filters"), load-more
  error, `ListFooter`. Pass it as `saved` / `recovered`. The footer shows
  only while paged or filtered: `ListFooter({ shown, total, more,
loading?, onLoadMore? })` reads "3 of 22" / "50 of 50+" (Load more while
  the server has more). `total` is for a list that is one part of a
  larger loaded source (the Timeline's halves).
- `CommitStateSplit` `variant="tabs"` (default) is for every full artifact
  table: the FF Tabs switch "Saved N" · "Recovered N" (`+` while more pages
  stand) on the left of a `Toolbar`, `toolbar` controls on the right, a
  hairline, then the active list. Controlled (`value` + `onValueChange`) or
  uncontrolled (`defaultValue`).
- `variant="stacked"` only for a small embedded table (the Sites
  drill-down): the saved list, then (only when there are recovered rows)
  a "Recovered N" sub-heading (`headingAs`, default `h3`) and the
  recovered list.
- Both variants carry the one plain-language explanation of "Recovered"
  as a tooltip (the Recovered tab, the stacked sub-heading): "Rows found
  only in Chrome's temporary database files (write-ahead log or rollback
  journal). They can include entries that were deleted or overwritten in
  the saved database."
- Figures that count rows (tiles, leaderboards, charts) count the saved list
  unless they are explicitly about recovered rows; never sum the two into
  one figure without saying so.
- Cache's route cannot filter by Commit State, so Cache splits its loaded
  page with `splitByCommit(rows)` → `{ saved, recovered }` and still shows
  two lists. The Timeline route can't either: it splits its loaded stream
  the same way into Saved / Recovered tabs, each still in time order.
- Activity (visits per day / hour): `useActivity()` / `fetchActivity()`
  (activity-data) return `{ saved, recovered, complete }` buckets; charts
  and figures draw `saved`, never summed with `recovered`, and say
  nothing about it (no "Saved only" tag, no footnote).

## Secrets: hidden by default

Values that are secrets (cookie values, saved-login passwords, Payment
form data) read "value hidden" in tables until a page-level "Show values"
`Switch` is on (where the page has one), and in the row sheet until
revealed there:
`<RowSheet selected={…} onClose={…} redactedFields={secretFieldsOf(row)} />`.
Each named field that holds a recorded, non-empty value opens hidden with a
Reveal / Hide button; (empty), absent and unavailable still show as words.

- `form-data.ts`: the Form data category rule (`categoryOf`,
  `FORM_DATA_CATEGORIES`, Payment first), `isPaymentField(name)` (Chrome's
  CREDIT*CARD*\* / IBAN names and the HTML ones: `cc-number`, `cc-exp`,
  `cc-csc`, `ccnum`, `security_code`, `exp_date`, `pan`,
  `routing_number`, `account-number`, …) and `isSecretFormField(field)`,
  which also **fails closed**: an entry whose `fieldName` is absent,
  (empty), unavailable or not a string is treated as secret (it still
  groups under "Other").
- `secrets.ts` (re-exported by `row-sheet.tsx`): `secretFieldsOf(row)` -
  a cookie's `value`, a saved login's `secret` (the password, in clear
  only after `--decrypt`), a secret form entry's `fieldValue` /
  `fieldValueLower`; `SEALED_REASON`. Unit-tested in `secrets.test.ts`
  (`vitest run client/src`).
- `row-sheet.tsx`: `SecretValueCell({ field, reveal, hint? })` and
  `HiddenValue({ hint? })` for table cells (`hint` is the tooltip; a page
  without a Switch says "Open the row to reveal it.").
- Form data, Cookies and the Timeline (once a Payment row is loaded) carry
  the "Show values" Switch; the Sites drill-down and Saved logins hide
  their secrets with the sheet as the one reveal.
- Saved logins: the Password cell reads "sealed" only for
  `encrypted_secret_without_key_material` (no key material); any other
  unavailable reason shows as itself; a decrypted password reads "value
  hidden". The Cookies "Sealed" figure counts the same reason only.

## MetricBand tone

`MetricBandItem tone` colours the progress fill and, beside the item's
`status` word, a state dot. It never shows on its own: without `status`
or `progress`, `tone` draws nothing. Write `tone="warning" status="recovered"`.

The figure itself is 24px (`typeClass("display", "compact")`) at semibold
with tabular digits, one clear step above the 16px panel title and below
the 28px page title; the label is caption, muted.

A figure that is not yet a number: `figure(read, show)` with a
`Read<T>` (`loading` → `PendingFigure` skeleton, `failed` →
`UnavailableFigure` "unavailable" + dot) - never a "0" or a dash. Below
`sm` the label, status word and detail wrap instead of truncating. A
figure value never truncates: it wraps (a dotted value such as a Chrome
build breaks after a dot, `<wbr>`). A figure with its exact reading in a
tooltip ("12 of 40 …") is `TooltipFigure({ value, detail })`: its own tab
stop with the FF focus ring, so keyboard users reach the tooltip too.

## Canonical patterns (one winner per repeated need)

| Need                       | Use                                                                                                                                                                                                                                            | Not                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Section with a header      | page-kit `SectionPanel` (`PanelHeader` + `PanelTitle` subtitle + `PanelDescription` body + caption `Count` + `aside`, `role="region"`, `aria-labelledby`)                                                                                      | local SectionPanel / WidgetPanel / hand-built `<h2>` headers              |
| Chart panel                | `ChartSection` (+ `footer`), body `px-2 pt-2 pb-3`, Recharts via the charts.tsx helpers                                                                                                                                                        | hand-built chart Panels, own tooltips, hand durations                     |
| Visits per day             | `ActivityBars` everywhere                                                                                                                                                                                                                      | a copied `BarChart`                                                       |
| Figure strip               | `MetricBand grid-cols-2 lg:grid-cols-4`: figures on the display role's compact step (24px semibold, tabular), caption labels, `detail` only when it is data                                                                                    | hand-built `<dl>` strips, captions under figures, `xl:`/`sm:` breakpoints |
| Toolbar                    | page-kit `Toolbar` under the list's `PanelHeader` (compact, `px-4 pt-1 pb-3`): the saved/recovered switch left, then `ml-auto` filters (`FilterField` + `Select`, `ProfilePicker`), `FilterTextField` (`w-60`) last                            | filter chips in the header action                                         |
| Search                     | `FilterTextField`: `commit="change"` for client-side filters, default Enter/blur for server queries                                                                                                                                            | raw `InputGroup`                                                          |
| Profile filter             | `ProfilePicker` (multi-pick)                                                                                                                                                                                                                   | `TabsSubtle` per profile                                                  |
| Table                      | FF `Table` in `scroll-fade-x overflow-x-auto px-1 py-1 [&_tbody>tr:last-child]:border-transparent`; `TableRow index tabIndex aria-label` + `ROW_FOCUS_CLASS`; `reveal-items` on the body only inside `reveal-swap`; first column header "Type" | `px-2` row insets                                                         |
| List body + footer         | `ListBlock` (its `ListFooter`: "3 of 22", only while paged or filtered)                                                                                                                                                                        | hand-built footers, "22 saved X shown"                                    |
| Two-line cell              | finding-fields `TwoLineCell` (name over URL, URL mono)                                                                                                                                                                                         | local stacked spans                                                       |
| Chip filter with counts    | page-kit `CountChips`                                                                                                                                                                                                                          | per-page TabsSubtle rows                                                  |
| Commit State mark          | `StateWord` in cells (no own tab stop in a focusable row), `CommitBadge` in the sheet header                                                                                                                                                   | hand-rolled dots                                                          |
| Other state marks          | `EvidenceDot state="neutral"` + word for anything that is no evidence state (a download outcome, an expired cookie, a verified entry, a key present); evidence hues (amber, violet, red, green) only for evidence states                       | a state hue borrowed for a different meaning                              |
| Non-state labels           | plain `Badge`, no dot                                                                                                                                                                                                                          | grey-dot Badges                                                           |
| Ranked bars                | page-kit `ShareBar`; a distribution is a charts `SegmentBar`                                                                                                                                                                                   | `bg-foreground opacity-*` bars, a row of mostly-zero bars                 |
| Clickable list             | FF `CardGroup` for entities, or `useFluidHover` + `h-9` button rows + `WeightLabel` + `bg-active` when selected                                                                                                                                | `py-2` / `py-2.5` / `h-8` rows                                            |
| Empty                      | `EmptyRows` (icon + title + message when the page is empty; message + tertiary "Clear filters" when filtered); `ChartEmpty` in charts                                                                                                          | plain `<p>` empties                                                       |
| Error                      | `ErrorRows` (title ends with "."), also for load-more                                                                                                                                                                                          | captions in `text-destructive`                                            |
| Loading                    | `reveal-swap` with a skeleton the size of the real block (`LoadingRows` for tables), `role="status"` + `aria-label`                                                                                                                            | ternary swaps, `aria-hidden` skeletons                                    |
| Page root                  | `flex flex-col gap-5`; grids `gap-4`                                                                                                                                                                                                           | `gap-4` / `gap-6` roots                                                   |
| Row sheet title            | the recorded name, else a kind noun ("Cookie", "Download")                                                                                                                                                                                     | invented words                                                            |
| Values that can't be shown | words ("absent", "unavailable", "not recorded"), never "-"                                                                                                                                                                                     | dashes                                                                    |

## Legacy CSS (removed)

The compat shims (`components/compat/*`), `stat-tile.tsx`,
`artifact-page.tsx` (with the dead `FindingsTable`, `FilterBar`,
`ListCard`), `cache-kit.tsx` (now page-kit) and `history-coverage.tsx` are
gone, and so are the legacy classes `.fx-hero`, `.fx-rise`,
`.metric-band-*`, `.fx-scroll-x` and the legacy tokens
(`primary-foreground`, `accent-border`, `inverse`, `edge-shadow`, and the
`bg-primary` / `text-primary` utility aliases), and `--primary` itself
(charts are ink, see "Charts"). `ui/misc.tsx` keeps only `Skeleton`; its
legacy `Input`, `SelectNative`, `Chip`, `Labeled` and `Kbd` are gone (use FF
`InputGroup`, `Select`, `CheckboxGroup`). `ChartToggle`, `ChartLegend`,
`CoverageDial`, `SectionHeading`, `CredentialAgeScatter`, `MeterList`,
`CompletenessPanel`, `PanelContent`, `SavedOnlyTag` (and
`history-chart-parts.tsx`) and the unused role icons were removed.

The per-page `*-wash` and `*-border` evidence tokens (`bg-wal-wash`,
`border-destructive-border`, …) remain valid. They are derived from the state
hues. Prefer `EvidenceBadge`, `EvidenceDot`, and `Banner`, which already use
them correctly.
