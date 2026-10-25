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
- **Focus rings are for the keyboard:** every ring is `:focus-visible`
  only. Radix Tabs focus a tab from their own mousedown (a scripted
  focus Chrome counts as keyboard-like), so every `TabItem` takes
  `onMouseDown={focusTabWithoutRing}` (`components/pointer-focus.ts`);
  check a ring with a real mouse press (`agent-browser mouse down/up`),
  not `click()`.
- **Don't add hand-written timings,** apart from the 80ms color/weight
  transitions FF itself uses (`duration-80`). For anything else, use
  `spring.fast | moderate | slow`, with `.exit` for dismissals.

## Declutter rules (every page)

The decluttered pages follow these; keep new work to them.

- **No page subtitles.** A page has its H1 only (Overview: the Case id,
  its Sources / Profiles line and the Profile account line).
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
  hides rows: "3 of 22", "50 loaded" with Load more (`ListFooter`; "3 of 50+" when a filter also hides rows). Never
  "22 saved X shown".
- **State column:** only in the Recovered tab (it separates unsaved from
  overwritten); the Saved tab has none, every row there is saved.
- **Monospace only for code-like values** (URLs, paths, ids, hashes,
  cookie names); see "Type".
- **One control height in a panel:** 28px (compact) for every header and
  toolbar control.
- **Plain hyphens in copy:** user-visible text uses "-" (" - " between
  phrases, "6-10 Apr" in a range), never an em or en dash.
- **Each fact once, in its best place.** A count a widget already titles
  (Saved logins' "Reused usernames 1") is no figure too; a field a figure
  or card shows is not listed again below it (Browser profile's recorded
  fields list what the strip and the cards do not).
- **No degenerate column.** A column that reads the same on every row of
  a list, with a figure already saying so (Cookies' Secure at 100%,
  Cache's Integrity all "verified"), is left out of that list; decide it
  over the list's loaded rows, never the filtered ones, so a filter never
  adds or drops a column. The row sheet keeps the field.
- **Stable columns.** Short-valued columns (times, flags, words) carry a
  fixed width that fits their longest value; one flexible column (the
  page, the host) takes the rest, so a day click, a range, a reveal or a
  tab never shifts the columns.
- **Hosts are read whole** where the table has room: host columns get the
  width, flag columns stay narrow.

## What is installed

| Area                               | Files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Components (`src/components/ui/`)  | accordion, badge, banner, button, card, checkbox-group, combobox, command-menu, dialog, dropdown (+ dropdown-search, dropdown-sub, menu-item), input-copy, input-group, mobile-drawer, radio-group, scroll-area, select, sidebar (+ sidebar-core, sidebar-menu), skeleton, slider, switch, table, tabs, tabs-subtle, tooltip                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Systems (`src/lib/`, `src/hooks/`) | springs, font-weight, size-context, type-scale, shape-context, surface-context, surface-classes, elevated, icon-context, icons-untitledui, popup, omit, utils (`cn`), fluid-provider, sidebar-menu-grid; hooks: use-fluid-hover, use-merge-split, use-keyboard-nav-gate, use-touch-primary; `src/components/fluid-hover-highlight.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| CSS (`src/app.css`)                | FF tokens, the surface and shadow ladders, the type scale, `.typeset`, native scrollbars, `scroll-fade` / `scroll-fade-x` / `scroll-divider`, and `reveal-*`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Block                              | `src/components/sidebar-app/*` (App Sidebar: `inset-topbar`, `search-field`, `user-footer`, `workspace-header`). The block's demo assembly (`app-sidebar.tsx`, `nav-data.ts`) was removed as unused; the real shell lives in `src/app.tsx`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Built on FF here                   | `ui/popover.tsx`, `ui/sheet.tsx`, `ui/misc.tsx` (Skeleton), `components/panel.tsx`, `components/evidence.tsx`, `components/term.tsx`, `components/list-states.tsx`, `components/page-kit.tsx` (see "The page kit"), `components/responsive-rows.tsx`, `lib/app-icons.ts` (see "Icons"), `components/completeness.tsx`, `components/row-sheet.tsx`, `components/form-data.ts`, `components/metric-band.tsx`, `components/activity-data.ts`, `components/day-bounds.ts`, `components/secrets.ts`, `components/site-favicons.ts`, `components/pointer-focus.ts`, `components/charts.tsx` + `charts-ready.tsx` + `chart-section.tsx`, `components/related-links.tsx`, `components/host-link.tsx` (see "Cell links"), `components/identity-kit.tsx`, `components/url-host.ts`, `components/row-lookup-notice.tsx`, `src/row-lookup.ts`, `src/case-context.tsx`, `src/command-menu.tsx`, `src/command-index.ts`, `src/field-values.ts`, `components/use-drained-read.ts`, `src/count-reads.ts` (see "Figures from the server's counts"), `components/bytes.ts`, `src/view-lens.tsx`, `src/pages.ts` + `src/page-views.tsx` (the page registry), `src/focus.ts`, `src/read-pages.ts`, `src/field-readers.ts`, `src/site-host-key.ts`, `src/menu-open.ts`, `components/commit-state-page.tsx`, `components/site-kinds.ts`, `components/candidates-page.tsx` (see "The Candidates page") |

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
- **The Case context is the shell's** (`src/case-context.tsx`): it reads
  the Completeness Statement and the profiles once
  (`useCaseContextRead`) and provides them (`CaseContextProvider`); a page
  that needs them reads `useCaseContext()` (`{ context, error, retry }`)
  or one artifact's scope with `useArtifactCoverage(artifact)` - never its
  own `completeness` / `profiles` request (Overview, Browser profile, the
  Timeline and `useProfileLens` read the context; the identity pages'
  empty states the scope). Overview also reads `summary` (the Case id and
  its Sources) for its masthead.
- The page header is the shell's: the page title alone (no description
  line) and, at the right of the title row, the page's coverage indicator.
  When something in the page's scope was not read, the coverage banner
  sits directly under the header, above your page; under it, the shell's
  `RowLookupNotice` speaks for a row the URL names that the page had not
  loaded (see `useRowSelection`). Pages render no
  coverage of their own (see "Evidence coverage"). Overview builds its own
  masthead (`PAGES.overview.ownHeader`): it places a quiet whole-Case
  indicator at the masthead's right itself and carries **no banner**.
- Icons are Untitled UI: `FluidProvider icons={untitleduiIcons}` swaps every
  FF component glyph, and app code imports its own icons by role from
  `@/lib/app-icons` (see "Icons"). Never import `lucide-react` in new code.
- The column provides **surface level 2**. A `Panel` lands on surface 3, and
  popups and dialogs open from there and walk further up the ladder on their
  own.
- Pages start at the top of the page. The document scrolls, not the inset, so
  sticky elements stick to the viewport.
- **The page is in the URL** (see "URL state and the lens"): the shell reads
  it, sets `document.title` ("History · ForensiX", "teamviewer.com · Sites
  · ForensiX"), and on a page change moves focus to the page's h1
  (`tabIndex={-1}`, no ring) and says the page in its polite live region
  ("History - 12 Mar 2024" when the page applies the lens). After a pick in
  the phone drawer the drawer's focus hand-back to its trigger is redirected
  to the h1. A page that builds its own h1 (Overview) gets focus once the
  h1 renders.
- **The topbar** carries, at its right, the lens chip (`ViewLensChip`,
  `src/view-lens.tsx`) and the ⌘K trigger ("Jump to" + caps; icon only below
  `sm`, where the breadcrumb also gives way to the page's h1). The ⌘K dialog
  (`CaseCommandMenu`, `src/command-menu.tsx`) and the J / K keys
  (`useGlobalRowKeys`, `src/shortcuts.ts`) are installed once by the shell,
  with the scoped `[` (`useSidebarKey`; see "Keyboard and ⌘K").

## Which component for which need

| Dashboard need                                                                    | Use                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Framed section (stat band, chart, table card)                                     | `SectionPanel` from page-kit (or the raw `Panel`, `PanelHeader`, `PanelTitle`, `PanelDescription`, `PanelFooter` from `@/components/panel` when it doesn't fit). Heading level: `PanelTitle as="h3"` / `SectionPanel headingAs`, never `role="heading"`                                                                                                                                                                                                      |
| Chart panel                                                                       | `ChartSection` (`action` for a control, `footer` for a note, `description` only when it adds information)                                                                                                                                                                                                                                                                                                                                                    |
| Saved vs recovered rows                                                           | `useCommitStateLists` + `CommitStateSplit` (see "Saved and recovered rows")                                                                                                                                                                                                                                                                                                                                                                                  |
| Clickable card grid or list (e.g. Top sites tiles)                                | FF `CardGroup` + `Card` (`columns` > 1 gives 2-D fluid hover). Its cards are transparent on purpose, so put the group inside a Panel if it needs a frame                                                                                                                                                                                                                                                                                                     |
| Evidence table                                                                    | FF `Table`, `TableHeader`, `TableBody`, `TableRow index={i}` (body rows only), `TableHead`, `TableCell`. Rows sit on the 36px ladder, or 28px with `size="compact"`. **TYPE is the first column of a table that mixes record types** (forensic rule 2); a single-type table adds none. Render it through page-kit `ResponsiveRows` so a phone gets stacked row cards (TYPE / time and State stay on the first line); it adds `scroll-fade-x` on the scroller |
| Row detail side panel                                                             | `RowSheet` from `components/row-sheet` (built on `Sheet`; `redactedFields` hides secrets until revealed). Raw `Sheet` + `SheetContent` (+ `SheetHeader`, `SheetTitle`, `SheetDescription`, `SheetBody`, `SheetFooter`) only for a non-row sheet                                                                                                                                                                                                              |
| Modal                                                                             | FF `Dialog` (`size` sm, lg, or xl)                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Single-choice filter (sort, transition, profile)                                  | FF `Select` (`SelectTrigger`, `SelectContent`, `SelectItem index value`). `size="compact"` in filter bars                                                                                                                                                                                                                                                                                                                                                    |
| Searchable, multi-pick, or create filter                                          | FF `Combobox`                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Text search field                                                                 | FF `InputGroup` + `InputField` (with `labelHidden` and the `search` icon for a toolbar search). `misc.Input` is only for legacy forms                                                                                                                                                                                                                                                                                                                        |
| Segmented control (2-4 mutually exclusive views, e.g. newest/oldest, bytes/count) | FF `Tabs` + `TabsList` + `TabItem` (`size="compact"` in a toolbar); `CommitStateSplit` for saved/recovered                                                                                                                                                                                                                                                                                                                                                   |
| Tab navigation inside a page (e.g. per-profile sections)                          | FF `TabsSubtle` + `TabsSubtleItem`                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Multi-select toggles (profiles)                                                   | FF `CheckboxGroup` in a popover or panel (`ProfilePicker`)                                                                                                                                                                                                                                                                                                                                                                                                   |
| One-of chip filter with counts (event types, form categories)                     | page-kit `CountChips` in the list `Toolbar`'s trailing controls: "All N" then "Label N" (count muted, tabular), fluid hover, wraps from `sm`; below `sm` one labelled compact Select with every count (no chip hidden past the edge)                                                                                                                                                                                                                         |
| Actions menu or "more"                                                            | FF `DropdownMenu`, `DropdownTrigger`, `DropdownContent`, `MenuItem`                                                                                                                                                                                                                                                                                                                                                                                          |
| Anchored panel (date range calendar, etc.)                                        | `Popover`, `PopoverTrigger`, `PopoverContent` from `@/components/ui/popover` (`flush` drops the 4px padding)                                                                                                                                                                                                                                                                                                                                                 |
| Copy a hash, path, or URL                                                         | FF `InputCopy`                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Show/hide details                                                                 | FF `Accordion`                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Toggle a setting                                                                  | FF `Switch`                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Jump-to / ⌘K                                                                      | The shell's `CaseCommandMenu` (FF `CommandMenu` in FF `Dialog`); add rows there, never a second palette                                                                                                                                                                                                                                                                                                                                                      |
| Buttons                                                                           | FF `Button`: `primary` for the one main action, `secondary` for ordinary actions, `tertiary` for bordered or quiet actions ("Load more"), `ghost` for icon and toolbar buttons. Sizes: default 36px, `compact` 28px, `icon` / `icon-compact`. Use the `loading` prop rather than swapping the label                                                                                                                                                          |
| Evidence-state chip                                                               | `EvidenceBadge state="produced \| unavailable \| absent \| empty \| committed \| wal \| journal \| warning"` with the **state word as its children**                                                                                                                                                                                                                                                                                                         |
| State word in a cell or text                                                      | `EvidenceDot state=…` + the word on `text-foreground` or `text-muted-foreground` (`state="neutral"`, a hollow ring, for plain labels such as Complete / Primary / Backup). Existing helpers: `StateWord`, `CommitBadge`, `AbsentWord`                                                                                                                                                                                                                        |
| A field's value in a cell                                                         | `FieldCell field=…` (finding-fields) or `TimeCell field=…` (page-kit) - never `fieldText(...) ?? "absent"`, which turns (empty) and unavailable into "absent"                                                                                                                                                                                                                                                                                                |
| Unavailable, error, or warning state                                              | FF `Banner` (`status="error" \| "warning" \| "info"`, `contrast="high"` inline). It must include `BannerTitle` + `BannerDescription` with the reason (the shell's one-line `CoverageBanner` carries its reason in the title). For a failed read with Retry, use `ErrorRows` from `list-states`                                                                                                                                                               |
| Term that needs explaining                                                        | `Term label=… technical="Technical: …"` from `@/components/term`. For a custom trigger, use `TermTooltip` + `TermExplanation`. Use FF `Tooltip content=…` for short labels                                                                                                                                                                                                                                                                                   |
| Loading rows                                                                      | `ListBlock` for a whole list body; else `LoadingRows` or `Skeleton` (see Loading below)                                                                                                                                                                                                                                                                                                                                                                      |
| Rendered prose or markdown                                                        | `.typeset` on the container                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## Type: six roles, three weights, two colors

The scale (`--fs-*` / `--lh-*` in app.css) is written in rem - FF's px
values at the browser's 16px default - so a reader's larger default font
size grows the dashboard (zoom still works). Two px sizes remain outside
app CSS: Recharts' tick labels (`fontSize: 12`, an SVG attribute) and the
registry's `pointer-coarse:text-[16px]` field rule.

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
  Pinned: cookie values (tokens, `SecretValueCell mono`), and in the row
  sheet every id / hash field's value (`visitId`, `payloadSha256`), so it
  reads in the same face as the source chain's "Row id". Form field names
  are labels (`formFieldLabel`), never mono.

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
- **One easing system.** Motion code uses the spring tiers; CSS uses their
  `linear()` forms (app.css `--reveal-motion`: `reveal-product` is
  `spring.moderate`, `reveal-landing` is `spring.slow`), and the only
  other CSS timing is FF's 80ms colour / weight step. No `ease-*` curves,
  no hand-written durations (FF's own copy check, `pathLength` in 0.08s, is
  the one registry exception and the row sheet's "Copy citation" mirrors
  it exactly).
- **The motion inventory** - meaningful state changes only, each on its
  tier, all respecting reduced motion:
  - copy confirmation: FF InputCopy's swap (`spring.fast`, drawn check),
    mirrored by "Copy citation";
  - sheet: FF Sheet (`spring.moderate`, `.exit` to leave);
  - tab: FF Tabs' indicator; a list switching tab re-reveals its rows;
  - range: the wash and its baseline glide (`spring.moderate`) and fade
    (`spring.fast`); the date picker's range pills travel
    (`spring.moderate`, shared layout ids);
  - list reveal: `reveal-swap` + `reveal-items`;
  - ⌘K: FF Dialog + CommandMenu; popovers `spring.fast`;
  - hover: fluid highlights and the chart band / bar lift (`spring.fast`).
- **No decoration and no count-ups.** Nothing animates for its own sake
  (no attention pulses, bounces or shimmer beyond FF's skeleton), and a
  number never counts up: its in-between values would be figures the
  evidence never recorded. A figure appears at its value.

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
  - every bar rests at `SERIES.rest` (0.5: 3.4:1 on a light panel, 4.6:1
    on a dark one - WCAG 1.4.11's 3:1 for a graphic that carries data);
    **exactly one emphasis** at full ink: the selection when there is one,
    else the peak (ties share it). Never a second colour or an outline for
    "selected";
  - outside an active range bars stay at rest (`SERIES.dimmed` is the same
    step, so a picked day that drew nothing never fades the rest to
    near-invisible); the range itself is a `chartRange(tokens)` wash (ink
    at 0.06) behind the bars with a 2px baseline under it at the rest step
    (`ChartRangeWash`), drawn for one picked day too - an empty picked day
    still shows where the range is;
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
- **No Recharts entrance animation** (`CHART_STATIC` on every series):
  bars draw in the frame their data and layout land; the panel's
  `reveal-swap` fade is the entrance (and respects reduced motion).
  Recharts' tween is keyed to the identity of the series' derived
  geometry, so every re-render that rebuilt it (an inline `dataKey`
  arrow, a page loading its lists, a pointer resting on the chart)
  restarted it, and on a busy page the bars sat at zero height for
  seconds. Keep a `dataKey` function stable (`useCallback`) all the same.
- The tooltip box follows the pointer on `spring.moderate` written as its
  CSS `linear()` (`chartTooltipMotion`, the same curve as
  `reveal-product`), off under reduced motion.

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
  horizontal hairline grid), `CHART_STATIC` (no entrance tween),
  `chartTooltipMotion(reduced)`.
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
  drawing every day, the range washed in (with its baseline) and the days
  outside at rest, the picked days at full ink. Pointer cursor, fluid hover band. A day is
  picked on pointer-up (press and release on one day), never on `click`:
  the press re-renders the bars, so a `click` on the bar itself would never
  fire. A count axis with a peak of 1-4 stops at `max(peak, 2)` with one
  tick per whole count. Pass `range`
  - `onRangeChange` to `ActivityBars`; Downloads' bytes chart follows the
    same rule by hand, with round byte ticks (`byteTicks`: 10 / 20 / 30 /
    40 MB, the last at or above the peak).
- **Day ticks stand under the bar they name** (`dayTickIndices`,
  chart-keys.ts, unit-tested): about one label per 64px, each on its
  regular slot or, when that day drew nothing, on the nearest day that did
  within half a slot (a label is wider than a band, so "23 Mar" on an
  empty day read as the label of the 24 Mar bar beside it); never closer
  than 48px.
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
  back to UTC days. That one Case zone is for server `from` / `to` bounds
  only: a page that buckets or filters _loaded_ rows by day (Downloads,
  Cache, Overview's ranged Recent downloads) reads each row's day in the
  zone its own timestamp declares (`fieldZone(field)`, the
  `ForensicTimestamp.declaredTimezone`; UTC when none) and never waits for
  the History activity read. When the loaded rows declare more than one
  zone the chart's footer says so in one quiet line (`zonesNote`). Times in
  tables stay UTC (their header says so).

## URL state and the lens (`src/router.ts`, `src/view-state.tsx`)

The hash is the address: `#/history?from=2024-03-12&to=2024-03-14&profile=Default&host=…&q=…&filter=…&tab=recovered&row=…`.
The server serves one file, so nothing changes server-side. Back / Forward
and a refresh restore the view; a copied URL opens it.

- `router.ts` (pure, unit-tested in `router.test.ts`): `ViewLocation`
  (`page: PageKey`, `from`, `to`, `profiles`, `host`, `q`, `filter`, `tab`,
  `row`), `parseLocation(hash)` / `formatLocation(view)` (round-trip; one
  view, one URL: fixed parameter order, the profile pick sorted
  (`canonicalProfiles`); unknown or malformed parts fall back per part),
  `withPage(view, page, extras)` (the lens travels, the page's own state
  starts fresh), `rowRefOf(row)` (the row's record id, `history:180`,
  which core keeps unique in the Case, across Sources and Profiles; a row
  without an id falls back to `legacyRowRefOf`: manifest path | table |
  row id | profile | Commit State; null when it has neither),
  `rowMatchesRef(row, ref)` (the record id, or the legacy reference an
  older link still carries - so an old link still opens its row; no new
  link is built from the legacy form while a row has an id) and
  `isRecordId(ref)`.
- **The page registry** (`pages.ts`, pure): `PAGE_KEYS` (nav order),
  `PageKey`, and `PAGES: Record<PageKey, PageMeta>` - each page's `label`,
  sidebar `group`, `coverage` (Completeness artifacts; null = the whole
  Case), `artifact` (its `ArtifactConfig`, null for a merged view), `lens`
  (`range`: the time it narrows a date range by, or null; `profiles`) and
  `ownHeader` (Overview builds its own masthead). The router, the shell,
  the lens chip and ⌘K all read it; `page-views.tsx` binds each key to its
  component (`PAGE_COMPONENTS`, typed over every key) and `ARTIFACT_ICONS`
  to its icon. A new page is one entry in each, checked by the compiler.
- `view-state.tsx` - the store and the hooks. Every setter writes the URL;
  nothing is mirrored in component state.

| Hook / function                                                  | Use                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useViewRange()` → `[range, setRange]`                           | The Case-wide date range (`{ from, to }`, Case days, `""` open). Drop-in for a page's `useState({ from: "", to: "" })`; pushes a history entry. Whether the page applies it is the registry's (`PAGES[page].lens`)                                                                                                                                                        |
| `useViewProfiles()` → `[profiles, setProfiles]`                  | The Case-wide profile pick (empty = every profile); same contract                                                                                                                                                                                                                                                                                                         |
| `useViewState()`                                                 | The lens without claiming it (`range`, `profiles`, `active`, `setRange`, `setProfiles`, `clear`) - the shell's chip and ⌘K                                                                                                                                                                                                                                                |
| `useViewTab()` → `[tab, setTab]`                                 | The page's Saved / Recovered switch. Drop-in for `useState<CommitView>("saved")`; replaces the entry                                                                                                                                                                                                                                                                      |
| `useViewHost()` → `[host, setHost]`                              | The host a page is on (Sites); pushes                                                                                                                                                                                                                                                                                                                                     |
| `useViewSearch()` → `[q, setQ]`                                  | The page's search text (History; a Related link opens History searched for a URL); replaces                                                                                                                                                                                                                                                                               |
| `useViewFilter()` → `[filter, setFilter]`                        | The page's own one-of pick (Bookmarks folder, Form data category, Timeline event kind, Sites kind). Drop-in for `useState<string \| null>(null)` (updater functions work); replaces. A new host (`useViewHost`) clears it                                                                                                                                                 |
| `useRowSelection(rows, lookup?)` → `{ selected, select, close }` | The open row sheet. Pass every loaded row (both lists); `selected` is the row the URL names once it is loaded; opening pushes an entry, closing steps back over it. A row without a reference still opens, unaddressed. With `lookup` (`{ route, parameters?, byCommitState? }`, the page's route) a URL-named row the lists do not hold is read by its reference (below) |
| `updateView(patch, { replace? })`                                | Several parts in one entry (a page's "Clear filters")                                                                                                                                                                                                                                                                                                                     |
| `openPage(page, extras?)`, `hrefFor(page, extras?)`              | Navigate / build a real `<a href>` with the lens carried                                                                                                                                                                                                                                                                                                                  |

History entries: a page, a range, a profile pick, a host and an opened row
each push one; a tab switch, a search and a filter pick replace. "Clear
filters" is one entry (`updateView({ q: null, filter: null, profiles: [] })`).

**A row the URL names that the page has not loaded** (a Timeline "Open
this row in Cookies" on a large Case, a copied URL, a refresh deep in a
paged list): `useRowSelection(rows, { route })` gives the page's own
first read a beat (600ms), then reads the row by its reference
(`findRowByRef`, `src/row-lookup.ts`). For a record id it first reads the
record itself (`get?id=`): an id the Case does not hold (404
`RECORD_NOT_FOUND`), or a record a later Analysis Run superseded, is not
found at once. The record names its profile and Commit State (a legacy
reference carries them itself), so the lookup then reads that profile's
rows of that state on the page's own route, page by page (100 a page, at
most 50 pages), until the row with exactly that reference turns up, and
the sheet opens on it. The row comes from the page's route, in the
page's shape. Nothing is matched loosely. While it reads, the shell's
`RowLookupNotice` says "Opening the row this link names…"; when it is
not found it says why - no row on the page has that reference, or it is
not among the first 5,000 rows of its profile - with Close (drops the row
from the URL). Every page passes its route as a stable `RowLookupSource`
(a module constant or a memo; History `view=visits`; Cache and
Candidates without a Commit State filter (`byCommitState: false`); the
Timeline its own stream with its direction, range and profile pick; a
Sites host `site-findings?host=`). An abandoned lookup is aborted on the
wire. A sheet never opens under the ⌘K menu (`menu-open.ts`): a row
the URL names while the menu is open opens once it closes; a sheet already
open stays and switches rows.

**The lens.** One date range and one profile pick for the whole Case. A
page that filters by them reads `useViewRange` / `useViewProfiles`; the
topbar chip (`ViewLensChip`) shows the lens with a clear button - the
parts the page on show applies in the foreground, the rest muted after
"Not applied on <page>:" (so a page never looks filtered when it is not,
and the lens never looks lost). Its name says each part in words with
what it filters by or why not ("Showing 13 Mar 2024, by start time.",
"13 Mar 2024 is not applied: Cookies does not filter by date."). A page
whose own date picker shows the applied range (Overview, History,
Timeline, Downloads, Cache) does not get the range twice: the chip then
carries only the profile pick, and its clear leaves the range to the
picker. Clearing announces what is shown now and returns focus to the h1.

Where the lens applies: range - Overview, History, Timeline, Downloads,
Cache; profiles - History, Timeline, Candidates, Downloads, Cache,
Browser profile and every artifact page with a profile picker.

- **On the server** (repeated `profile` parameters): History, the
  Timeline (the stream holds the picked profiles' events only; the chart
  draws the picked profiles' activity rows, which record their profile),
  Candidates and the pages on `useProfileLens()` (identity-kit: Cookies,
  Saved logins, Form data, Bookmarks, Top sites, Favicons). `useProfileLens`
  gives `selected`, `setSelected`, `options` (every profile the Case knows,
  `caseProfilesOf`, plus any picked that it does not; never `""` or the
  Source-level `"."`), `showPicker`, `parameters` (the pick as repeated
  `profile` pairs; none for every profile) and `words` (for empty states).
  Spread `lens.parameters` into the route's parameters: the lists, tabs
  and server counts then hold exactly the picked profiles' rows, never a
  filter over the rows loaded so far.
- **On the client** (still): Downloads, Cache and Browser profile filter
  their loaded rows by each row's recorded profile. The Downloads and
  Cache pickers list the profiles the loaded rows carry, plus any picked;
  Browser profile's lists every profile the Case knows.

Not applied (the chip says so): the range on pages whose routes take no
date (Cookies, Saved logins, Form data, Bookmarks, Top sites, Favicons,
Browser profile, Candidates, Sites) and the profile pick on Overview and
Sites (Sites does not send it) - never filtered by inference.

**Migration for page agents** (wired today: the range on Overview,
History, Timeline, Downloads and Cache; the profile pick on every page
listed above; History search; Sites host; the tab and the open row on
every saved / recovered page):

1. Range: `const [range, setRange] = useState({ from: "", to: "" })` →
   `const [range, setRange] = useViewRange()`.
2. Profiles: `const lens = useProfileLens()`,
   `ProfilePicker selected={lens.selected} onChange={lens.setSelected}`,
   and `...lens.parameters` in the route's parameters (a page with its own
   picker: `useViewProfiles()` and the `profile` query parameters from it).
3. Open row: replace `useState<SelectedRow | null>` with
   `const sheet = useRowSelection(allLoadedRows)` (memoise the array);
   `onSelect={sheet.select}`, `<RowSheet selected={sheet.selected}
onClose={sheet.close} />`.
4. A Sites-like host or a search that should survive Back: `useViewHost` /
   `useViewSearch`; a chip / Select pick: `useViewFilter`.

## Related evidence and the row sheet

`RowSheet` (row-sheet.tsx) now has, under the source chain:

- **Related** (`RelatedLinks`, `components/related-links.tsx`, builders in
  `src/related.ts`, unit-tested in `related.test.ts`): links that filter
  another page by a value the row records exactly - never an inferred
  relationship.
  - host → Sites (`hostLinkOf`): the first host core's Sites puts the row
    on - `siteHostsOf` over `SITE_HOST_FIELDS`, imported from core
    (`src/site-host-key.ts` re-exports `core/src/site-host-key.ts`, the
    module core's Sites queries key hosts with, so a link can never name a
    host Sites does not list the row under). `siteHostKey` keys a URL by
    its hostname, a cookie host key by itself, one leading dot removed,
    lower case; nothing else, so `www.example.com` stays a host apart from
    `example.com`. Host fields per kind: a visit's / bookmark's / top
    site's `url`, a cookie's `hostKey`, a login's `originUrl`, a
    download's `urlChain`, `referrer` and `tabUrl`, a cache entry's `key`
    read through `cacheResourceUrl` (the resource is the key's last part,
    behind any `_dk_` isolation scope), a favicon's `iconUrl` and
    `pageUrls`. Offered only when Sites lists that host (`siteHostListed`,
    the one rule the cell links share);
  - day → Timeline (`dayLinkOf`: the Case day of the row's own timestamp,
    the field `FINDING_KINDS[kind].time` in artifacts.ts, in the Case's
    declared timezone; when the Case's timezone read fails no day link is
    offered and the block says so - a day is never guessed in UTC);
  - URL → History (`visitedUrlsOf` + `visitLinksOf`: a download's tab page
    or referrer, a bookmark's or top site's URL): only visits whose `url`
    is the same string (`exactVisitsOf`, case-reads.ts), each opening its
    own row; past `VISIT_LINKS` one "N more visits" link opens History
    searched for the URL.
  - Links are real `<a href="#/…">` (new tab works; Back returns to the
    row). A link to the view already on show is left out; a kind with
    nothing linkable shows no section. Pass `related={false}` only where
    the sheet already sits on the related page.
- **Field labels:** each field reads by its human label with the raw wire
  name as a mono caption (`fieldLabel(name, kind)`, `src/field-labels.ts`;
  unknown names are spelled out, never hidden). Timestamps read as the
  tables write them plus "UTC" (`TimeText`), the ISO instant on hover. The
  header names the kind in words (`FINDING_KINDS[kind].noun`, raw kind on
  hover), never the snake_case kind.
- **Field values** (`humanizeFieldValue`, `src/field-values.ts`,
  unit-tested): a decoded enum (download outcome, danger type, interrupt
  reason; cookie SameSite, priority, source scheme and type; visit source;
  favicon icon type) reads as a word ("Not dangerous") with the recorded
  token as a mono caption (`not_dangerous`); a boolean reads Yes / No with
  `true` / `false` as the caption; a byte count reads "9,873,300 bytes (9.4
  MB)" with the recorded number on hover. Anything else is shown as
  recorded. Code-like values (paths, URLs) wrap after their separators
  (`breakAtSeparators`: a `<wbr>` after "/", ".", "-" …, no character
  added, so the copied value is exact), mid-token only when one segment
  cannot fit.
- **Copy citation** (header, stays put while the body scrolls): one line of
  provenance for a report - `Artifact: History (history_visit) · Profile:
Default profile · Source: … · File: … · Table: visits · Row id: 500106 ·
Commit State: committed · Record id: history:180` plus any content hash
  the row records
  (`payloadSha256`, …) - `citationOf` in related.ts. `Source` (also the
  first line of the source chain) and `Record id` show only when the row
  carries them: a Case can hold several Sources with the same relative
  file, and these two keep the citation unique. Never a field value,
  so a secret stays out whether or not it is revealed. FF's copy
  confirmation (InputCopy's drawn check and "Copied", `spring.fast`) and a
  polite "Citation copied." for screen readers.

## Cell links (`components/host-link.tsx`)

One component per pivot for every table, one read of the Sites host list
per session (shared with the Related block):

- `SiteHostLink({ host, className, children })` - a recorded host, URL or
  cookie host key that opens Sites on that host (`siteHostKey`) once Sites
  is known to list it; plain text until then and for good when it does
  not (a host list cut short at its page cap cannot rule a host out, so
  then every host links). `UrlWithSiteLink({ field })` - a URL field on a
  two-line cell's muted line, its host part linked (`splitUrlHost`,
  url-host.ts). `VisitedUrlLink({ url })` - a URL that opens History
  searched for it, on the tab that holds its visits, only when History
  has a visit to exactly that URL. `useSiteHosts()` / `siteHostListed(key)`
  - the lookup itself.
- A cell link is a pointer shortcut inside a row that opens a sheet: its
  click never opens the sheet, it takes no tab stop (`tabIndex={-1}`; Tab
  and J / K walk rows - the sheet's Related block is the keyboard path),
  and a phone card (a button) draws the value as plain text. A real
  `<a href>` carrying the lens of the moment it is used.
- Look: the cell's own text and colour; the underline shows only while
  the row is hovered (muted) and firms to the text colour under the
  pointer (80ms colour step).

## Keyboard and ⌘K (`src/shortcuts.ts`, `src/command-menu.tsx`, `src/command-index.ts`)

- **Rows:** J or ↓ next row, K or ↑ previous, in page order (past one
  list's end into the next); from outside a list J lands on the first row,
  K on the last; Enter / Space opens the row (the rows' own
  `activateOnKey`). ↑ / ↓ act only on a row. The shell installs
  `useGlobalRowKeys(column)`; `useRowKeyboardNav(ref)` scopes the same keys
  to one list container (for `ResponsiveRows` / a table) and lets a move
  past its end through to the page handler. Rows match `ROW_NAV_SELECTOR`
  (`[data-row-nav]`, else `tbody > tr[tabindex="0"]` and `[role=button]`
  cards); only rendered rows count.
- **Single-key shortcuts are scoped (WCAG 2.1.4).** J / K act only while
  focus is on a row, inside a list (a table, `[data-row-nav-list]`), or on
  the page itself (the body, the page's h1) - never on a button, link,
  tab, chart, field, menu or dialog, never from the sidebar or topbar, and
  never with a modifier (Shift included). `[` (show or hide the sidebar)
  acts only from the page itself: FF's own app-wide binding is off
  (`SidebarProvider shortcut={null}`) and `useSidebarKey` binds the scoped
  one. All three can be turned off from ⌘K ("Single-key shortcuts: on /
  off", `localStorage["forensix.singleKeyShortcuts"]`). The decisions are
  pure and unit-tested (`rowKeyDelta`, `sidebarKeyFires`,
  `parseSingleKeySetting`; `focusPlaceOf` reads the DOM). FF's sidebar
  tooltips still show `[` (the registry shows the default key even when
  its binding is off).
- **Focus returns where it was** (`focus.ts`, one module). Dialogs place
  focus from their own Radix `onCloseAutoFocus`: a ⌘K pick runs there,
  once the menu has closed, so the focus it moves (a page's h1, a row, a
  sheet) and the words it announces are never taken over by the dialog's
  restore or hidden by its modal; closing ⌘K without a pick returns focus
  to what had it (a row, the trigger; else the page's h1), as closing a
  row sheet does. Each ⌘K opening is a fresh dialog, and a pick still
  waiting when the menu is reopened runs first. A sidebar collapse that
  hides the focused element hands focus to the topbar's sidebar trigger;
  closing the linked-row banner focuses the page's h1.
- **⌘K** (FF `CommandMenu` in FF `Dialog`, mod+K, also the topbar's "Jump to"; its
  input is named "Jump to"): Pages (nav order); with no query, Recent days
  (the latest 7 days with saved page visits); once a query is typed, the
  Case index (rules in `command-index.ts`, unit-tested): Hosts (every host
  Sites lists, opening Sites on it), Files (download file names, opening
  that exact Downloads row), Usernames (saved-login usernames with their
  site, opening that exact Saved logins row - never a password field) and
  Days (every day with saved page visits, typed "12 Mar", "Mar 12",
  "12 March" or "2024-03-12", opening the Timeline on it). Each group
  lists its first 8 matches, then "N more … match" (Sites, Downloads and
  Saved logins open searched for the query; days ask for more of the
  date). The index reads start the first time the menu opens and are made
  once per session (`case-reads.ts`); "Still reading the Case" shows while
  they land. Theme (Light / System / Dark via `chooseTheme`); Shortcuts
  (`SHORTCUTS`, with caps, plus the single-key switch). A query nothing
  matches is written into an always-mounted polite region. Shortcuts are
  listed here and nowhere else - no how-to copy on pages.

## Profiles: one name, one count

`profileLabel(profile)` (finding-fields) is the one way a profile is
written - the picker (`ProfilePicker` options and summary), the coverage
banner, tables, the row sheet, the lens chip, the citation.
`caseProfilesOf(profiles, completeness)` (completeness.tsx) is every
profile the Case knows - the profiles route plus any the Completeness
Statement names (a Guest profile with nothing read) - and is the one
"Profiles" count (the Overview masthead's Case line) and the one list of
profile options (`useProfileLens`), so it agrees with the coverage
detail.

## Forensic presentation rules (non-negotiable)

1. The **Completeness Statement** ("Evidence coverage") is visible before any
   row on every evidence page: the shell's indicator in the title row, plus
   a banner above the page whenever anything in scope was not read.
2. **TYPE is the first column of a table that mixes record types** - the
   Timeline's event kinds, a Finding / Candidate list. A single-type table
   is exempt: a TYPE column would read the same on every row (see "No
   degenerate column"), so none is added; a kind column that does vary
   (Downloads' file kind, Form data's category) may still lead.
3. **value / (empty) / absent / unavailable** are distinct words, never color
   alone. A Badge or dot only repeats the word.
4. **Sidecar rows** (WAL / rollback journal) are a **separate list** from
   committed rows. Never merge them into one table - the Timeline too splits
   its loaded stream into Saved and Recovered tabs, each in time order.
5. **No Candidate value on a tile.** Stat tiles show recorded facts only.
6. Read-only: no control may start ingest, analysis, or export.

## The Candidates page (`components/candidates-page.tsx`)

Candidates are ranked identity and behavior hypotheses that the analyzer
makes from the recorded rows (`candidates` route): a name, an e-mail
address, a frequently visited host, a repeated search. They are never
facts, and every surface says so in words.

- The page is in the sidebar's **Case** group (`PAGES.candidates`,
  coverage `["Candidates"]`, lens: profiles only - the route takes a
  profile, never a date).
- **Labelled Candidate:** the list panel is "Ranked candidates" with a
  "Candidate" badge that explains the term; each group is "<kind>
  candidates"; the sheet's header carries the same badge where a
  Finding's sheet carries its Commit State.
- **Ranked:** the list is the server's order (`sort=rank`, keyset-paged
  with Load more), grouped by kind on the client. Each row shows its rank
  (1 is the strongest in its kind and profile), the value as a Field
  State, its supporting row count and the recorded evidence basis. The
  sheet adds the source chain of the primary row and of each supporting
  row.
- **No Commit State:** a Candidate comes from saved and recovered rows
  alike, so the page has no Saved / Recovered split, no State column and
  no Commit State badge. Its row reference is its record id only
  (`identity-candidates:1`); the row lookup does not filter by Commit
  State.
- The profile pick (`useProfileLens`) and the category pick (`filter`:
  identity or behavior) are server filters. No Candidate value becomes a
  figure or a tile (rule 5).

## Rules from the impeccable passes

Recorded from the lead's decisions (forensic rules above still win):

- **Overview stays calm:** no coverage banner (the quiet indicator only);
  a compact Recovered panel counts recovered rows per page (unsaved /
  overwritten, each worded; exact counts from the server: `summary` names
  the kinds with recovered records, one `count by=commitState` per kind
  splits them), links to each page's Recovered tab and is never added
  into a figure. The figure strip has three figures.
- **The Overview masthead names the Case, never a person:** the h1 is the
  Case id (`summary.caseId`, "Case " before it unless the id already says
  so); under it one line of what the Case holds - "2 Sources · 3
  Profiles · Chrome …" (Profiles is every profile the Case knows,
  `caseProfilesOf`, incl. a Guest with nothing read; the names in its
  tooltip); then the account line (`ProfileAccountLine`), scoped to one
  Profile in words ("Default profile account: …": the Default profile
  when it recorded metadata, else the first). Each account field keeps
  its Field State in words ("name absent", "e-mail unavailable"), the
  Profile words link to its row on Browser profile, and "N more
  profiles" links to Browser profile. The Profile panel beside the
  activity is titled with that Profile's name; its "Browser country" is
  recorded by the browser, not the Profile.
- **Figures never overstate:** download sizes are bytes received ("9.4 of
  28.2 MB" when short, "expected" only when only the total is recorded);
  outcomes are words; Most visited and Sites use one measure (saved visit
  rows per host); counts of loaded rows say so ("+", "loaded").
- **Days are Case days** everywhere (History, Timeline, Overview,
  Downloads, Cache) with the one UTC fallback.
- **Contrast:** muted text passes 4.5:1 on every surface it sits on,
  hover and selected included; the focus ring passes 3:1 at 2px
  effective; chart bars at rest pass 3:1, inside and outside a range.
- **Cross-links filter by exact recorded values only** (host → Sites,
  URL → its visits, day → Timeline, row → its own page); never an
  inferred relationship. Cell links take no tab stop; the sheet's Related
  block is the keyboard path.
- **The URL holds the view** (page, range, profiles, host, search, the
  page's own pick, tab, open row): Back / Forward / refresh restore it,
  and a URL-named row opens even when the page had not loaded it.
- **Sites is the full host view, owned by core:** the host list
  (`site-hosts`) and a host's rows (`site-findings`) group the same eight
  kinds by the same rule - visits, downloads, cookies, saved logins,
  bookmarks, top sites, favicons and cache entries (`SITE_HOST_FIELDS`;
  `SITES_COVERAGE` covers their artifacts) - so a host seen only in a
  download is listed, and the detail header's "5 saved rows in 4 kinds"
  is the card's "5 saved rows". The client reads `site-findings` only
  (no per-kind drains); each row says which fields record the host
  (`hostFields`, the "Host in" column). The kinds' words and icons are one
  table (`components/site-kinds.ts`). The most-evidenced host is shown
  when none is picked.
- **Figures from the server's counts** (`src/count-reads.ts`,
  unit-tested in `count-reads.test.ts`): a figure or tab count over a
  whole list is asked of the server, never drained from its rows.
  `useCount({ kind, by, profiles?, commitState? })` reads `count` (one
  kind's active records grouped by a field, or by `profile` /
  `commitState`; at most `COUNT_BUCKET_LIMIT` (100) buckets, the rest in
  `otherCount`); `useCommitStateTotals(kind, profiles)` gives the saved /
  recovered totals that the tabs show (Cookies, Saved logins, Form data,
  Bookmarks, Favicons); `distinctValues`, `recordsWhere` and
  `commitStateTotals` read a result, with a `Tally` that says when it is
  only a floor (`formatTally`: "100+"). Each count carries the page's
  profile pick, so it matches the lists. `summary` gives the Case id,
  Sources, Profiles and records per kind (Overview). The old background
  drain of `useCommitStateLists` and its per-page row caps are gone;
  figures a page still sums over its loaded rows say so ("+").
- **Counts follow the lens on one base.** A page's tab counts, list footer
  and figures count the same rows for the same lens: Downloads and Cache
  tabs and footers count the rows in the range and profile pick (the
  figures' base), so a day reads "Saved 1" beside its one row, never an
  all-days total.
- **One paging primitive** (`read-pages.ts`): every read that follows a
  route past its first page goes through `readPages(route, parameters,
{ cap, signal, onPage })` (`complete` only when the route ran out), every
  session-wide read through `once(read)` (made once, a failure forgotten),
  and every Commit-State split through `COMMIT_STATES` /
  `withCommitState`. The row lookup, Overview's loaders, the ⌘K index, the
  activity read and the visit-presence queue all carry an `AbortSignal`.
- **Drained reads paint early** (`useDrainedRead`,
  `components/use-drained-read.ts`, on `readPages`, up to a page cap; the
  one drain that remains): Cache, Downloads and the Sites host list and
  host rows show their first
  page at once and read the rest in the background (counts "+", a muted
  "Reading the rest of …" line above the figures, the footer's "Reading the
  rest of the list…"); every read carries an `AbortSignal` (unmount, Retry
  or new parameters abort the request in flight), as `usePaginatedList`
  does too.
- **A failed read says which failure** (`ApiError`, `src/api.ts`,
  unit-tested): the server did not answer (stopped), refused this tab's
  token (restarted - open the new link), or answered with its own error;
  the browser's or server's words follow in brackets, never alone.
- **Rows:** a clickable table row is named by its cells (read with their
  headers) and described by one hint ("Enter opens this row's detail."); a
  phone card's button is named by its short action and described by its
  own content (`aria-describedby`).
- **Time columns say UTC** in their header ("Created (UTC)"; the phone
  card keeps the plain word as its label) on every table, Sites included.
- **Touch targets:** on a coarse pointer the sheet's close is 40px, the
  phone drawer's nav rows are 40px (app.css overrides the registry height),
  and small icon controls in dense rows (the lens chip's clear, a bookmark
  folder's chevron) take a 40px ring (`.coarse-hit`); a Term in a column
  header gets the same grown hit area as a figure label.
- **Delight and motion** stay inside FF's motion system: meaningful state
  changes only (see "Motion"), no decoration, no count-ups.
- **Phone toolbars** keep to two rows with `CompactFilters`.

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
  databases first - within a group, and the groups themselves (a group
  holding an unread database sorts above the fully read ones).
- **`CoverageBanner({ completeness, artifacts?, className? })`** - renders
  only when something in scope was not read: one line in an FF Banner
  (`error` when anything is unreadable, else `warning`; compact, low
  contrast) naming what - "Cookies could not be read - Database locked.",
  "No Form data database in Profile 3 (Guest) - …", "No Bookmarks file"
  (the store word follows the artifact, `artifactStoreOf` in artifacts.ts:
  SQLite artifacts say database, Bookmarks / Preferences / Local State say
  file, the disk cache says folder; `UnreadPage` and the identity pages'
  empty states use the same word), or "Not everything was
  read: History in Profile 2, Cookies." - with a "Details" action opening
  the same detail. Healthy coverage: no banner, no panel.
- Scope: `artifacts` are Completeness artifact keys from `src/artifacts.ts`
  (`ArtifactConfig.completenessArtifact`: "History", "Cookies", "Login
  Data", "Top Sites", "Downloads", "Bookmarks", "Web Data", "Cache",
  "Favicons", "Preferences"; the Candidates page uses "Candidates");
  merged views use `TIMELINE_COVERAGE` (History,
  Downloads, Cookies, Web Data - what core's queryTimeline merges) and
  `SITES_COVERAGE` (History, Downloads, Cookies, Login Data, Bookmarks, Top
  Sites, Cache, Favicons - every kind core's Sites groups). Omit it for the
  whole Case. The shell picks the scope from the page registry
  (`PAGES[page].coverage`).
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
| `IconTile({ icon })`                                                                                   | 32px tinted tile with a muted icon (panel headings only, never a table cell)                                                                                                                                                                                                                                                                                                                                                                                       |
| `TypeLabel({ icon, label })`                                                                           | The TYPE column's cell on every table: bare muted icon + the worded type in the cell's color                                                                                                                                                                                                                                                                                                                                                                       |
| `ShareBar({ fraction, peak?, className? })`                                                            | One share-of-peak pill in the series style: ink, peak full / others at rest (translateX)                                                                                                                                                                                                                                                                                                                                                                           |
| `CountChips({ label, allLabel?, total, chips, active, onChange, partial? })`                           | The one chip filter with counts (Timeline event types, Form data categories, Sites kinds): FF parts, 28px pills, muted tabular counts, fluid hover on both axes; wraps from `sm`, scrolls sideways with no scrollbar (`scroll-fade-x`) below. `partial`: the counts are of the rows loaded so far and more stand - each reads "36+" (the Saved / Recovered tabs' "+") and the row's name says "counts of loaded rows"; never an "All loaded" label                 |
| `formatDaySpan(first, last)`                                                                           | "11 Mar - 17 Apr" (one year), "9 Dec 2023 - 4 Jan 2024", "4 Mar 2024" (one day): a span as figure data                                                                                                                                                                                                                                                                                                                                                             |
| `CARD_TITLE_CLEAR`                                                                                     | Class for an FF CardTitle that must stay on one line                                                                                                                                                                                                                                                                                                                                                                                                               |
| `CommitStateSplit`, `CommitView`, `splitByCommit`                                                      | Saved / recovered (below)                                                                                                                                                                                                                                                                                                                                                                                                                                          |

Also shared: `FieldCell({ field, format?, truncate?, mono? })`,
`TwoLineCell({ primary, secondary?, mono?, avatar?, avatarSrc? })` (the
one two-line cell: a name, title or host over its URL / path / realm, the
second line muted, compact and mono; `avatar` adds a `SiteAvatar`,
`avatarSrc` puts a recovered favicon in it),
`isCodeLike`, `codeClass`, `profileLabel` ("Default" → "Default profile",
"Profile 2" stays - never print "Profile " before it), `fieldString`,
`fieldBool`, `fieldText`, `fieldUtc`, `fieldInteger`, `AbsentWord`,
`StateWord({ state, focusable? })`, `SiteAvatar({ host, size?, src? })`
(finding-fields; `src` is a recovered favicon `data:` URI, drawn 16px in
the same 28px tile as the letter, so rows with and without one align);
`FilterField`, `FilterTextField({ …, commit? })`, `ProfilePicker`,
`SortSelect`, `CompactFilters` (filters); `SiteHostLink`,
`UrlWithSiteLink`, `VisitedUrlLink` (host-link, see "Cell links");
`useProfileLens`, `ArtifactEmpty`, `EmptyPivot` (identity-kit); `EmptyRows`, `activateOnKey`, `ROW_FOCUS_CLASS` (data-table);
`ListBlock`, `RevealSwap`, `LoadingRows({ rows?, label? })`, `ErrorRows`,
`ListFooter` (list-states); `figure`, `PendingFigure`, `UnavailableFigure`
(metric-band); `useActivity`, `bucketsToDays`, `bucketsToHourTotals`, `fillGaps`
(activity-data); `categoryOf`, `isPaymentField`, `formFieldLabel`
(form-data: the one field-name label - "NAME_FULL" → "Full name",
"search-query" → "Search query" - on Form data, the Timeline and Sites;
the sheet keeps the raw name); `secretFieldsOf`,
`SecretValueCell({ field, reveal, hint?, mono? })`, `HiddenValue`
(row-sheet); `fetchSiteFavicons`, `useOwnBitmaps` (site-favicons: the
`site-favicons` route's per-host icon - the widest saved bitmap, a host's
avatar - and each favicon row's own bitmap by the `payloadSha256` it
records, saved or recovered, from `favicon-bitmaps`, which returns a
payload only when its bytes hash to it); `matchesSearch(query, texts)`
(filters: a loaded row's search, never over a hidden secret);
`focusTabWithoutRing` (pointer-focus, below);
`TooltipFigure` (metric-band); `dayRangeParameters`, `localDayOf`
(day-bounds).
The readers (`fieldText` …) return `null` for absent, (empty) and
unavailable alike - use them to compute, and `FieldCell` / `TimeCell` to
show.

## Saved and recovered rows (forensic rule 4) - one pattern

Sidecar (WAL / rollback-journal) rows are always their own list, read as
their own server query (`commit-state=committed | wal_resident |
journal_resident` on every Finding route except `cache`; `timeline`,
`site-findings` and `count` take it too; the design mock honours it).

```tsx
import { useCommitStateTotals } from "../count-reads.js";
import { useCommitStateLists } from "../use-commit-state-lists.js";
import { useViewTab } from "../view-state.js";
import { useProfileLens } from "./identity-kit.js";
import { CommitStateSplit } from "./page-kit.js";

const lens = useProfileLens();
const parameters = useMemo(() => [...lens.parameters], [lens.parameters]);
const lists = useCommitStateLists<Finding>(config.route, parameters);
const totals = useCommitStateTotals("cookie", lens.selected);
const [view, setView] = useViewTab();

<SectionPanel title="All cookies">
  <CommitStateSplit
    value={view}
    onValueChange={setView}
    label="Saved or recovered cookies"
    {...commitStateStatus(lists, { saved: lists.saved.rows.length, recovered: lists.recovered.rows.length }, totals.state === "ready" ? totals.value : null, { filtered: lens.selected.length > 0 }).split}
    toolbar={<FilterTextField commit="change" … />}
    saved={<CookieTable list={lists.saved} />}
    recovered={<CookieTable list={lists.recovered} />}
  />
</SectionPanel>
```

- `useCommitStateLists<Row>(route, parameters, { enabled? })`
  returns `{ saved, recovered, settled }`, each list a `PaginatedList`
  (`rows`, `cursor`, `loading`, `error`, `loadMore`, `retry`).
  `recovered.rows` is the WAL list then the journal list (never
  interleaved); `recovered.loadMore` drains WAL first; `recovered.wal` /
  `recovered.journal` are the two underlying reads.
- `retry` re-reads only what failed (`usePaginatedList`): after a failed
  "Load more" it asks for that page again and keeps the loaded rows; the
  recovered list retries only its failed half.
- The lists read page by page (Load more) and never drain in the
  background: figures over a whole list come from the server's counts
  (see "Figures from the server's counts"). `settled.saved` /
  `settled.recovered` say when each list has read its first page.
- **One status model** (`commitStateStatus(lists, shown, totals?,
{ filtered? })`, and `mixedReadStatus` for Cache's one mixed read):
  `pageEmpty` (both lists read empty, nothing failed or in flight, and no
  server filter such as the profile pick (`filtered`) narrows them),
  `figures` (`loading` / `show` / `hide`: no saved row in the lens, or a
  failed saved read), and `split` - the `CommitStateSplit` counts and "+"
  markers, spread onto the switch (`{...status.split}`). With `totals`
  (`useCommitStateTotals`) the tabs read the whole lists' sizes, no "+";
  without them, the loaded rows (`tabCount`: unknown until a page lands
  and after a failed first read) and "+" while more pages stand. `CommitStatePage({ status, empty, figures,
figuresSkeleton, sheet, children })` draws the frame every saved /
  recovered page shares; the page supplies only its empty state, figures,
  list panel and sheet.
- `ListBlock({ list, noun: { one, many }, shown?, filtered?, onClearFilters?, empty, total?, children })`
  (list-states) is the body of one list: skeleton → rows (`RevealSwap`),
  failed first read, empty or filtered-empty ("Clear filters"), load-more
  error, `ListFooter`. Pass it as `saved` / `recovered`. The footer shows
  only while paged or filtered: `ListFooter({ shown, total, more,
loading?, onLoadMore? })` reads "3 of 22" / "50 loaded" / "3 of 50+" (Load more while
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
  two lists. The Timeline route takes `commit-state` now (its row lookup
  uses it), but the page reads one chronological stream and splits its
  loaded pages the same way into Saved / Recovered tabs, each still in
  time order.
- Activity (visits per day / hour): `useActivity()` / `fetchActivity()`
  (activity-data) return `{ saved, recovered, complete }` buckets; charts
  and figures draw `saved`, never summed with `recovered`, and say
  nothing about it (no "Saved only" tag, no footnote). When `complete` is
  false (the page cap stopped the read) every figure built from it is a
  floor: counts read "+" (History's and Overview's figures), a share names
  its base ("of the first N loaded", Cache's integrity share).

## Secrets: hidden by default

Values that are secrets (cookie values, saved-login passwords, Payment
form data) read "value hidden" in tables until a page-level "Show values"
`Switch` is on (where the page has one), and in the row sheet until
revealed there:
`<RowSheet selected={…} onClose={…} redactedFields={secretFieldsOf(row)} />`.
Each named field that holds a recorded, non-empty value opens hidden with a
Reveal / Hide button; (empty), absent and unavailable still show as words.
The sheet's fields are keyed by the row (its reference, or a key of its own
when it has none), so a reveal never carries over when the open sheet
switches to another row (a click behind it, ⌘K): the next row's secrets open hidden.

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

| Need                       | Use                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Not                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Section with a header      | page-kit `SectionPanel` (`PanelHeader` + `PanelTitle` subtitle + `PanelDescription` body + caption `Count` + `aside`, `role="region"`, `aria-labelledby`)                                                                                                                                                                                                                                                                                                  | local SectionPanel / WidgetPanel / hand-built `<h2>` headers              |
| Chart panel                | `ChartSection` (+ `footer`), body `px-2 pt-2 pb-3`, Recharts via the charts.tsx helpers                                                                                                                                                                                                                                                                                                                                                                    | hand-built chart Panels, own tooltips, hand durations                     |
| Visits per day             | `ActivityBars` everywhere                                                                                                                                                                                                                                                                                                                                                                                                                                  | a copied `BarChart`                                                       |
| Figure strip               | `MetricBand grid-cols-2 lg:grid-cols-4`: figures on the display role's compact step (24px semibold, tabular), caption labels, `detail` only when it is data                                                                                                                                                                                                                                                                                                | hand-built `<dl>` strips, captions under figures, `xl:`/`sm:` breakpoints |
| Toolbar                    | page-kit `Toolbar` under the list's `PanelHeader` (compact, `px-4 pt-1 pb-3`): the saved/recovered switch left, then `ml-auto` filters (`FilterField` + `Select`, `ProfilePicker`) inside `CompactFilters active={n}` (below `sm` one tertiary "Filters (n)" button opening them stacked in an FF popover, so a phone toolbar keeps two rows: the switch, then Filters + search), `FilterTextField` (`w-60`; below `sm` it takes the rest of its row) last | filter chips in the header action                                         |
| Sort                       | filters `SortSelect({ id, options: SortOption[], value, onChange })`: one Select of worded orders ("Last used, newest"), asked of the server (`sort` + `direction`), never a re-sort of the loaded page of a paged list (Cookies, Saved logins)                                                                                                                                                                                                            |
| Search                     | `FilterTextField`: `commit="change"` for client-side filters, default Enter/blur for server queries                                                                                                                                                                                                                                                                                                                                                        | raw `InputGroup`                                                          |
| Profile filter             | `ProfilePicker` (multi-pick)                                                                                                                                                                                                                                                                                                                                                                                                                               | `TabsSubtle` per profile                                                  |
| Table                      | FF `Table` in `scroll-fade-x overflow-x-auto px-1 py-1 [&_tbody>tr:last-child]:border-transparent`; `TableRow index tabIndex aria-label` + `ROW_FOCUS_CLASS`; `reveal-items` on the body only inside `reveal-swap`; a mixed-type table's first column header "Type"                                                                                                                                                                                        | `px-2` row insets                                                         |
| List body + footer         | `ListBlock` (its `ListFooter`: "3 of 22", only while paged or filtered)                                                                                                                                                                                                                                                                                                                                                                                    | hand-built footers, "22 saved X shown"                                    |
| Two-line cell              | finding-fields `TwoLineCell` (name over URL, URL mono)                                                                                                                                                                                                                                                                                                                                                                                                     | local stacked spans                                                       |
| Chip filter with counts    | page-kit `CountChips`                                                                                                                                                                                                                                                                                                                                                                                                                                      | per-page TabsSubtle rows                                                  |
| Commit State mark          | `StateWord` in cells (no own tab stop in a focusable row), `CommitBadge` in the sheet header                                                                                                                                                                                                                                                                                                                                                               | hand-rolled dots                                                          |
| Other state marks          | `EvidenceDot state="neutral"` + word for anything that is no evidence state (a download outcome, an expired cookie, a verified entry, a key present); evidence hues (amber, violet, red, green) only for evidence states                                                                                                                                                                                                                                   | a state hue borrowed for a different meaning                              |
| Non-state labels           | plain `Badge`, no dot                                                                                                                                                                                                                                                                                                                                                                                                                                      | grey-dot Badges                                                           |
| Ranked bars                | page-kit `ShareBar`; a distribution is a charts `SegmentBar`                                                                                                                                                                                                                                                                                                                                                                                               | `bg-foreground opacity-*` bars, a row of mostly-zero bars                 |
| Clickable list             | FF `CardGroup` for entities, or `useFluidHover` + `h-9` button rows + `WeightLabel` + `bg-active` when selected                                                                                                                                                                                                                                                                                                                                            | `py-2` / `py-2.5` / `h-8` rows                                            |
| Empty                      | `EmptyRows` (icon + title + message when the page is empty; message + tertiary "Clear filters" when filtered); `ChartEmpty` in charts                                                                                                                                                                                                                                                                                                                      | plain `<p>` empties                                                       |
| Error                      | `ErrorRows` (title ends with "."), also for load-more                                                                                                                                                                                                                                                                                                                                                                                                      | captions in `text-destructive`                                            |
| Loading                    | `reveal-swap` with a skeleton the size of the real block (`LoadingRows` for tables), `role="status"` + `aria-label`                                                                                                                                                                                                                                                                                                                                        | ternary swaps, `aria-hidden` skeletons                                    |
| Page root                  | `flex flex-col gap-5`; grids `gap-4`                                                                                                                                                                                                                                                                                                                                                                                                                       | `gap-4` / `gap-6` roots                                                   |
| Row sheet title            | the recorded name, else a kind noun ("Cookie", "Download")                                                                                                                                                                                                                                                                                                                                                                                                 | invented words                                                            |
| Values that can't be shown | words ("absent", "unavailable", "not recorded"), never "-"                                                                                                                                                                                                                                                                                                                                                                                                 | dashes                                                                    |

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
