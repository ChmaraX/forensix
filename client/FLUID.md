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

| Area | Files |
|---|---|
| Components (`src/components/ui/`) | accordion, badge, banner, button, card, checkbox-group, combobox, command-menu, dialog, dropdown (+ dropdown-search, dropdown-sub, menu-item), input-copy, input-group, mobile-drawer, radio-group, scroll-area, select, sidebar (+ sidebar-core, sidebar-menu), skeleton, slider, switch, table, tabs, tabs-subtle, tooltip |
| Systems (`src/lib/`, `src/hooks/`) | springs, font-weight, size-context, type-scale, shape-context, surface-context, surface-classes, elevated, icon-context, popup, omit, utils (`cn`), fluid-provider, sidebar-menu-grid; hooks: use-fluid-hover, use-merge-split, use-keyboard-nav-gate, use-touch-primary; `src/components/fluid-hover-highlight.tsx` |
| CSS (`src/app.css`) | FF tokens, the surface and shadow ladders, the type scale, `.typeset`, native scrollbars, `scroll-fade` / `scroll-fade-x` / `scroll-divider`, and `reveal-*` |
| Block | `src/components/sidebar-app/*` (App Sidebar). `app-sidebar.tsx` and `nav-data.ts` are the block's demo assembly, kept for reference and not used. The real shell lives in `src/app.tsx`. |
| Built on FF here | `ui/popover.tsx`, `ui/sheet.tsx`, `ui/misc.tsx` (Input, SelectNative, Chip, Labeled, Kbd, Skeleton), `components/panel.tsx`, `components/evidence.tsx`, `components/term.tsx`, `components/list-states.tsx` |
| Compatibility shims, to delete | `components/compat/button.tsx`, `components/compat/card.tsx` (see the end of this file) |

## The shell (do not restyle it per page)

`src/app.tsx` lays the page out like this: `FluidProvider` (reduced motion,
shape, size, and icons) → `TooltipProvider` → `SidebarProvider` →
`CaseSidebar` + `SidebarInset` → the topbar breadcrumb → **one
`reveal-product` column** with the page header and your page.

- The column already fades the page in: the header first, then your page
  root. **Do not put `reveal-product` or `reveal-landing` on your page.** That
  would animate a parent and its children both. For data that loads slowly,
  use `reveal-swap` + `reveal-items` (see Loading below).
- The column provides **surface level 2**. A `Panel` lands on surface 3, and
  popups and dialogs open from there and walk further up the ladder on their
  own.
- Pages start at the top of the page. The document scrolls, not the inset, so
  sticky elements stick to the viewport.

## Which component for which need

| Dashboard need | Use |
|---|---|
| Framed section (stat band, chart, table card) | `Panel`, `PanelHeader`, `PanelTitle`, `PanelDescription`, `PanelContent`, `PanelFooter` from `@/components/panel` |
| Clickable card grid or list (e.g. Top sites tiles) | FF `CardGroup` + `Card` (`columns` > 1 gives 2-D fluid hover). Its cards are transparent on purpose, so put the group inside a Panel if it needs a frame |
| Evidence table | FF `Table`, `TableHeader`, `TableBody`, `TableRow index={i}` (body rows only), `TableHead`, `TableCell`. Rows sit on the 36px ladder, or 28px with `size="compact"`. **TYPE is the first column.** For wide tables, use `scroll-fade-x` on the scroller instead of the legacy `.fx-scroll-x` |
| Row detail side panel | `Sheet` + `SheetContent` (+ `SheetHeader`, `SheetTitle`, `SheetDescription`, `SheetBody`, `SheetFooter`) from `@/components/ui/sheet` |
| Modal | FF `Dialog` (`size` sm, lg, or xl) |
| Single-choice filter (sort, transition, profile) | FF `Select` (`SelectTrigger`, `SelectContent`, `SelectItem index value`). `size="compact"` in filter bars |
| Searchable, multi-pick, or create filter | FF `Combobox` |
| Text search field | FF `InputGroup` + `InputField` (with `labelHidden` and the `search` icon for a toolbar search). `misc.Input` is only for legacy forms |
| Segmented control (2–4 mutually exclusive views, e.g. saved/recovered, newest/oldest) | FF `Tabs` + `TabsList` + `TabItem` (`size="compact"` in a toolbar) |
| Tab navigation inside a page (e.g. per-profile sections) | FF `TabsSubtle` + `TabsSubtleItem` |
| Multi-select toggles (event types, profiles) | FF `CheckboxGroup` in a popover or panel, or `misc.Chip` for a short inline row |
| Actions menu or "more" | FF `DropdownMenu`, `DropdownTrigger`, `DropdownContent`, `MenuItem` |
| Anchored panel (date range calendar, etc.) | `Popover`, `PopoverTrigger`, `PopoverContent` from `@/components/ui/popover` (`flush` drops the 4px padding) |
| Copy a hash, path, or URL | FF `InputCopy` |
| Show/hide details | FF `Accordion` |
| Toggle a setting | FF `Switch` |
| Jump-to / ⌘K | FF `CommandMenuDialog` |
| Buttons | FF `Button`: `primary` for the one main action, `secondary` for ordinary actions, `tertiary` for bordered or quiet actions ("Load more"), `ghost` for icon and toolbar buttons. Sizes: default 36px, `compact` 28px, `icon` / `icon-compact`. Use the `loading` prop rather than swapping the label |
| Evidence-state chip | `EvidenceBadge state="produced \| unavailable \| absent \| empty \| committed \| wal \| journal \| warning"` with the **state word as its children** |
| State word in a cell or text | `EvidenceDot state=…` + the word on `text-foreground` or `text-muted-foreground`. Existing helpers: `StateWord`, `CommitBadge`, `AbsentWord` |
| Unavailable, error, or warning state | FF `Banner` (`status="error" \| "warning" \| "info"`, `contrast="high"` inline). It must include `BannerTitle` + `BannerDescription` with the reason. For a failed read with Retry, use `ErrorRows` from `list-states` |
| Term that needs explaining | `Term label=… technical="Technical: …"` from `@/components/term`. For a custom trigger, use `TermTooltip` + `TermExplanation`. Use FF `Tooltip content=…` for short labels |
| Loading rows | `LoadingRows` or `Skeleton` (see Loading below) |
| Keyboard caps | `Kbd` from `ui/misc` |
| Rendered prose or markdown | `.typeset` on the container |

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
  (`misc.Chip` is an example).
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
  + `useRegisterFluidHoverItem` per row (see custom-motion.md). Never use
  per-row `hover:bg-*`. Only clickable rows register. Leave a list without
  fluid hover when a wrong click would hurt or only some rows are clickable.
- **Loading:** wrap the skeleton and the real block in `reveal-swap`, add the
  real block after the skeleton when data lands, and put `reveal-items` on
  both so the rows hand over one by one. Build each skeleton at the real
  block's size. Load each block on its own; never fake a sequence.
- Don't add new uses of the legacy `.fx-rise` / `--fx-delay`.

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

## Forensic presentation rules (non-negotiable)

1. The **Completeness Statement** ("Evidence coverage") renders before any row
   on every evidence page.
2. **TYPE is the first column** of every evidence table.
3. **value / (empty) / absent / unavailable** are distinct words, never color
   alone. A Badge or dot only repeats the word.
4. **Sidecar rows** (WAL / rollback journal) are a **separate list** from
   committed rows. Never merge them into one table. The Timeline is the one
   chronological stream, and each row carries its state word.
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

## Compatibility shims (migrate, then delete)

| Shim | Old API it keeps working | Migrate to |
|---|---|---|
| `components/compat/button.tsx` `Button` | Variants `default` → primary, `outline` (old default) → tertiary, `ghost` → ghost, `pill` → tertiary. Sizes `sm` → compact, `icon` → icon-compact, `default` → ladder | `@/components/ui/button`, with an explicit FF variant |
| `components/compat/card.tsx` `Card*` | `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent` (framed) | `@/components/panel` (framed) or `@/components/ui/card` (clickable cards) |
| `ui/misc.tsx` `Input`, `SelectNative`, `Chip` | The native field and chip APIs, re-skinned | FF `InputGroup`, `Select`, and `CheckboxGroup` / `TabsSubtle` where they fit |
| Legacy tokens and classes in `app.css` (section 8 and the "Legacy aliases"): `bg-primary`, `text-primary`, `accent-border`, `inverse`, `.fx-hero`, `.fx-rise`, `.metric-band-*`, `.fx-scroll-x` | Pages that still use them | FF surfaces, roles, and components. When the last page using one is migrated, delete its rule (check with `grep -r <name> src`) |

The per-page `*-wash` and `*-border` evidence tokens (`bg-wal-wash`,
`border-destructive-border`, …) remain valid. They are derived from the state
hues. Prefer `EvidenceBadge`, `EvidenceDot`, and `Banner`, which already use
them correctly.
