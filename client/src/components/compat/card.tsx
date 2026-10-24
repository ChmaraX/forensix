/**
 * COMPATIBILITY SHIM — delete once no page imports it.
 *
 * The pre-FF dashboard used a shadcn-style framed Card. FF's Card (now at
 * components/ui/card.tsx) is a different thing: transparent, borderless,
 * with fluid hover for clickable card groups. Pages that still import this
 * file get the old names and props, drawn as an FF Panel (see
 * components/panel.tsx), so they keep a framed surface until migrated:
 *
 *   Card            → Panel
 *   CardHeader      → PanelHeader
 *   CardTitle       → PanelTitle (subtitle role, semibold)
 *   CardDescription → PanelDescription (body role, muted)
 *   CardContent     → PanelContent
 *
 * Migrate a call site by importing from `@/components/panel` (a framed
 * section) or `@/components/ui/card` (a clickable card / card grid).
 */
export {
  Panel as Card,
  PanelContent as CardContent,
  PanelDescription as CardDescription,
  PanelHeader as CardHeader,
  PanelTitle as CardTitle,
} from "@/components/panel";
