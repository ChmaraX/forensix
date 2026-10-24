/**
 * Overview "Topic categorization" widget — the donut + legend read from
 * the local topic classifier, with a locked/blurred preview and an
 * "enable the model" Sheet when the classifier isn't available.
 *
 * STILL MOCK DATA: `MOCK_TOPICS` stands in for a real `topic-candidates`
 * fetch, and `topicState` is hardcoded to `"unavailable"` in `overview.tsx`
 * until the server exposes a `topic-status` route backed by
 * `TopicCandidateSummary` (see `core/src/history-topic-classification.ts`).
 * Wire both up before this ships for real.
 */
import { useState, type CSSProperties } from "react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { ArrowUpRight, Download, Lock } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./components/compat/card.js";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "./components/ui/sheet.js";

// ---------------------------------------------------------------------------
// Mock data — stands in for the real `topic-candidates` + `topic-status` API.
// ---------------------------------------------------------------------------

export type TopicState = "complete" | "unavailable";

interface MockTopicRow {
  readonly label: string;
  readonly share: number; // 0-100
  readonly count: number;
  readonly specialCategory: boolean;
}

const MOCK_TOPICS: readonly MockTopicRow[] = [
  { label: "Technology, Software & Developer resources", share: 34, count: 812, specialCategory: false },
  { label: "Search & Query", share: 21, count: 501, specialCategory: false },
  { label: "Entertainment, Streaming & Gaming", share: 14, count: 334, specialCategory: false },
  { label: "Shopping & Marketplace", share: 11, count: 262, specialCategory: false },
  { label: "Finance & Banking", share: 8, count: 190, specialCategory: false },
  { label: "Health & Medical", share: 6, count: 143, specialCategory: true },
];

const MOCK_UNAVAILABLE_REASON =
  "model_artifact_missing" as const; /* try: model_runtime_unavailable */

const REASON_COPY: Record<
  string,
  { readonly headline: string; readonly steps: readonly string[] }
> = {
  model_artifact_missing: {
    headline: "Topic model not downloaded",
    steps: [
      "Download the model: minishlab/potion-base-8M",
      "Point FORENSIX_TOPIC_MODEL_DIR at the model folder",
      "Re-run: forensix analyse --case <dir>",
    ],
  },
  model_runtime_unavailable: {
    headline: "Topic runtime not installed",
    steps: [
      "npm install onnxruntime-node @huggingface/transformers",
      "Re-run: forensix analyse --case <dir>",
    ],
  },
  model_load_failed: {
    headline: "Topic model failed to load",
    steps: [
      "Check FORENSIX_TOPIC_MODEL_DIR points at a valid model.onnx",
      "Re-run: forensix analyse --case <dir>",
    ],
  },
  inference_failed: {
    headline: "Topic classification failed mid-run",
    steps: ["Re-run: forensix analyse --case <dir>"],
  },
};

function PanelHeaderMini({
  title,
  description,
  linkLabel,
}: {
  readonly title: string;
  readonly description: string;
  readonly linkLabel?: string;
}) {
  return (
    <CardHeader>
      <div className="flex min-w-0 flex-col gap-1">
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </div>
      {linkLabel === undefined ? null : (
        <button
          type="button"
          className="mt-0.5 inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-sm text-[12.5px] font-medium text-primary underline-offset-4 transition-colors duration-150 hover:underline"
        >
          {linkLabel}
          <ArrowUpRight aria-hidden="true" className="size-3.5" />
        </button>
      )}
    </CardHeader>
  );
}

// ---------------------------------------------------------------------------
// Variant D — donut chart. "Unavailable" doesn't hide the widget or replace
// it with a CTA card: it renders the SAME chart, with the SAME example
// proportions a real Case would show, desaturated and blurred under a lock
// overlay — never a flat placeholder ring. The point is to preview the
// widget's real shape, closer to a paywall/feature-gate pattern than an
// empty state. Clicking the overlay opens a Sheet (the app's existing modal
// idiom, see row-sheet.tsx) with setup steps and a link out to the repo.
// ---------------------------------------------------------------------------

const PIE_TINTS = [
  "var(--primary)",
  "var(--violet)",
  "var(--success)",
  "var(--warning)",
  "var(--destructive)",
  "var(--muted-foreground)",
];

function TopicDonut({
  data,
  ghost = false,
}: {
  readonly data: readonly MockTopicRow[];
  readonly ghost?: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie
          data={data as MockTopicRow[]}
          dataKey="share"
          nameKey="label"
          innerRadius={56}
          outerRadius={88}
          paddingAngle={2}
          stroke="none"
          isAnimationActive={!ghost}
        >
          {data.map((entry, index) => (
            <Cell
              key={`${entry.label}-${String(index)}`}
              fill={PIE_TINTS[index % PIE_TINTS.length] as string}
            />
          ))}
        </Pie>
        {ghost ? null : (
          <Tooltip
            formatter={((value: unknown, _name: unknown, entry: unknown) => [
              `${String(value)}%`,
              ((entry as { payload?: MockTopicRow })?.payload)?.label ?? "",
            ]) as never}
          />
        )}
      </PieChart>
    </ResponsiveContainer>
  );
}

function EnableModelSheet({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const copy = REASON_COPY[MOCK_UNAVAILABLE_REASON] ?? REASON_COPY.model_artifact_missing;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="p-6">
        <SheetTitle className="text-[16px] font-semibold">
          Enable topic categorization
        </SheetTitle>
        <SheetDescription className="mt-1.5 text-[13px] text-muted-foreground">
          Topic categorization runs entirely on-device: a small (~30 MB) local
          classifier, no network calls, no evidence leaves this machine.
        </SheetDescription>
        <ol className="mt-5 flex flex-col gap-3">
          {copy?.steps.map((step, index) => (
            <li key={step} className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-accent-foreground">
                {index + 1}
              </span>
              <code className="min-w-0 flex-1 rounded-md bg-muted px-2 py-1.5 font-mono text-[12.5px] break-all">
                {step}
              </code>
            </li>
          ))}
        </ol>
        <a
          href="https://github.com/ChmaraX/forensix#topic-classification"
          target="_blank"
          rel="noreferrer"
          className="mt-6 inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-[13px] font-medium text-primary-foreground transition-colors duration-150 hover:opacity-90"
        >
          <Download aria-hidden="true" className="size-4" />
          Full setup instructions on GitHub
        </a>
      </SheetContent>
    </Sheet>
  );
}

/** Donut + legend, the whole visual payload of the card — shared by both
 *  states so "locked" previews the actual layout, not just the chart. */
function DonutAndLegend({ ghost = false }: { readonly ghost?: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[220px_1fr] sm:items-center">
      <TopicDonut data={MOCK_TOPICS} ghost={ghost} />
      <div className="flex flex-col gap-1.5">
        {MOCK_TOPICS.map((topic, index) => (
          <div key={topic.label} className="flex items-center gap-2 text-[12px]">
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-sm"
              style={{ background: PIE_TINTS[index % PIE_TINTS.length] }}
            />
            <span className="truncate">{topic.label}</span>
            <span className="ml-auto shrink-0 font-mono text-muted-foreground">
              {topic.share}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Step 8 in the page's fx-rise stagger (70ms/step): right after Top sites
// (step 7) and before Time of day (step 9), matching its position in the
// grid. Without this the card used to snap in instantly while every sibling
// card was still animating — reading as "already there" on every refresh.
const RISE_DELAY = { "--fx-delay": "560ms" } as CSSProperties;

export function TopicCategorizationCard({ state }: { readonly state: TopicState }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  return (
    <Card className="fx-rise col-span-12 sm:col-span-6" style={RISE_DELAY}>
      {/* No linkLabel: the button it drew was never wired to onClick, so a
          label pointing nowhere is worse than no label. */}
      <PanelHeaderMini
        title="Topic categorization"
        description="Share of classified URLs, by topic."
      />
      {/* flex-1 + justify-center: Top sites (its grid row partner) has six
          rows and naturally stretches taller, so this card's shorter donut
          content is centered in the extra height instead of leaving dead
          space below it. */}
      <CardContent className="relative flex flex-1 flex-col justify-center py-3">
        {state === "complete" ? (
          <DonutAndLegend />
        ) : (
          <div className="relative">
            {/* Ghost preview: the SAME donut + legend with example
                proportions, desaturated + blurred + dimmed — a preview of
                the real layout, never invented numbers passed off as real
                ones (the lock overlay below makes that unambiguous). */}
            <div
              aria-hidden="true"
              className="pointer-events-none opacity-60 blur-[2px] grayscale select-none"
            >
              <DonutAndLegend ghost />
            </div>
            <button
              type="button"
              onClick={() => {
                setSheetOpen(true);
              }}
              className="group absolute inset-0 flex flex-col items-center justify-center gap-2.5 rounded-lg bg-card/70 text-center backdrop-blur-[1px] transition-colors duration-150 hover:bg-card/85"
            >
              <span className="inline-flex size-9 items-center justify-center rounded-full bg-foreground text-background shadow-lg transition-transform duration-150 group-hover:scale-105">
                <Lock aria-hidden="true" className="size-4" />
              </span>
              <span className="max-w-[220px] text-[13px] font-medium">
                Download the local model to enable topic categorization
              </span>
              <span className="text-[12px] font-medium text-primary underline-offset-4 group-hover:underline">
                Show me how
              </span>
            </button>
          </div>
        )}
      </CardContent>
      <EnableModelSheet open={sheetOpen} onOpenChange={setSheetOpen} />
    </Card>
  );
}


