/**
 * Overview "Topic categorization" widget — a donut and a ranked legend read
 * from the local topic classifier, with a locked preview and an "enable the
 * model" Sheet when the classifier isn't available.
 *
 * Topic output is Candidate data: a ranked inference over recorded URLs, not
 * a recorded fact. The panel says so in its header (a "Candidate" badge with
 * its explanation) and in its legend (a ranked list), and none of it ever
 * feeds a figure or highlight elsewhere on the Overview.
 *
 * STILL MOCK DATA: `MOCK_TOPICS` stands in for a real `topic-candidates`
 * fetch, and `topicState` is hardcoded to `"unavailable"` in `overview.tsx`
 * until the server exposes a `topic-status` route backed by
 * `TopicCandidateSummary` (see `core/src/history-topic-classification.ts`).
 * Wire both up before this ships for real.
 */
import { Download, Lock } from "lucide-react";
import { useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { usePrefersReducedMotion } from "@/components/charts";
import { EvidenceBadge } from "@/components/evidence";
import { Panel } from "@/components/panel";
import { TermExplanation, TermTooltip } from "@/components/term";
import { Badge, badgeColors } from "@/components/ui/badge";
import { Banner, BannerDescription, BannerTitle } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { InputCopy } from "@/components/ui/input-copy";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Elevated } from "@/lib/elevated";
import { fontWeights } from "@/lib/font-weight";
import { typeClass } from "@/lib/size-context";
import { cn } from "@/lib/utils";

import { SectionHeader } from "./overview/parts";

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
  {
    label: "Technology, Software & Developer resources",
    share: 34,
    count: 812,
    specialCategory: false,
  },
  { label: "Search & Query", share: 21, count: 501, specialCategory: false },
  {
    label: "Entertainment, Streaming & Gaming",
    share: 14,
    count: 334,
    specialCategory: false,
  },
  {
    label: "Shopping & Marketplace",
    share: 11,
    count: 262,
    specialCategory: false,
  },
  { label: "Finance & Banking", share: 8, count: 190, specialCategory: false },
  { label: "Health & Medical", share: 6, count: 143, specialCategory: true },
];

const MOCK_UNAVAILABLE_REASON =
  "model_artifact_missing" as const; /* try: model_runtime_unavailable */

/** One setup step: what to do, and — when the step is a command, a model id
 *  or a variable name — the exact text to copy. */
interface SetupStep {
  readonly label: string;
  readonly value?: string;
}

const RERUN: SetupStep = {
  label: "Re-run the analysis",
  value: "forensix analyse --case <dir>",
};

const REASON_COPY: Record<
  string,
  { readonly headline: string; readonly steps: readonly SetupStep[] }
> = {
  model_artifact_missing: {
    headline: "Topic model not downloaded",
    steps: [
      { label: "Download the model", value: "minishlab/potion-base-8M" },
      {
        label: "Point this variable at the model folder",
        value: "FORENSIX_TOPIC_MODEL_DIR",
      },
      RERUN,
    ],
  },
  model_runtime_unavailable: {
    headline: "Topic runtime not installed",
    steps: [
      {
        label: "Install the runtime",
        value: "npm install onnxruntime-node @huggingface/transformers",
      },
      RERUN,
    ],
  },
  model_load_failed: {
    headline: "Topic model failed to load",
    steps: [
      {
        label: "Check this variable points at a valid model.onnx",
        value: "FORENSIX_TOPIC_MODEL_DIR",
      },
      RERUN,
    ],
  },
  inference_failed: {
    headline: "Topic classification failed mid-run",
    steps: [RERUN],
  },
};

// ---------------------------------------------------------------------------
// Donut + ranked legend. "Unavailable" doesn't hide the widget or swap it for
// a CTA card: it renders the SAME chart and legend with the SAME example
// proportions a real Case would show, desaturated and blurred under a locked
// card — a preview of the widget's real shape, never invented numbers passed
// off as real ones. "Show me how" opens a Sheet with the setup steps.
// ---------------------------------------------------------------------------

/** Badge hues, as plain hex: Recharts writes fills as SVG attributes, which
 *  cannot resolve `var()`, and these read in both themes. */
const TOPIC_TINTS = [
  badgeColors.blue,
  badgeColors.violet,
  badgeColors.emerald,
  badgeColors.amber,
  badgeColors.rose,
  badgeColors.gray,
] as const;

function tintOf(index: number): string {
  return TOPIC_TINTS[index % TOPIC_TINTS.length] ?? badgeColors.gray;
}

/** FF tooltip surface for a donut slice. */
function TopicTooltip({
  active,
  payload,
}: {
  readonly active?: boolean;
  readonly payload?: readonly { readonly payload?: unknown }[];
}) {
  const row = payload?.[0]?.payload as MockTopicRow | undefined;
  if (active !== true || row === undefined) {
    return null;
  }
  return (
    <Elevated
      offset={2}
      shadowLevel={3}
      className="flex max-w-[240px] flex-col gap-0.5 rounded-xl px-3 py-2"
    >
      <span className={cn(typeClass("caption"), "text-muted-foreground")}>
        {row.label}
      </span>
      <span
        className={cn(typeClass("body"), "text-foreground tabular-nums")}
        style={{ fontVariationSettings: fontWeights.semibold }}
      >
        {row.share}% · {row.count.toLocaleString("en-US")} URLs
      </span>
    </Elevated>
  );
}

function TopicDonut({
  data,
  ghost = false,
}: {
  readonly data: readonly MockTopicRow[];
  readonly ghost?: boolean;
}) {
  const reducedMotion = usePrefersReducedMotion();
  return (
    <ResponsiveContainer width="100%" height={196}>
      <PieChart>
        <Pie
          data={data as MockTopicRow[]}
          dataKey="share"
          nameKey="label"
          innerRadius={58}
          outerRadius={86}
          paddingAngle={2}
          cornerRadius={3}
          stroke="none"
          isAnimationActive={!ghost && !reducedMotion}
          animationDuration={240}
        >
          {data.map((entry, index) => (
            <Cell key={entry.label} fill={tintOf(index)} />
          ))}
        </Pie>
        {ghost ? null : (
          <Tooltip
            content={<TopicTooltip />}
            cursor={false}
            isAnimationActive={false}
            wrapperStyle={{ outline: "none" }}
          />
        )}
      </PieChart>
    </ResponsiveContainer>
  );
}

/** The ranked legend: rank, hue (repeating the slice), topic, share. */
function TopicLegend({ data }: { readonly data: readonly MockTopicRow[] }) {
  return (
    <ol className="flex min-w-0 flex-col" aria-label="Ranked topic Candidates">
      {data.map((topic, index) => (
        <li
          key={topic.label}
          className="grid h-8 grid-cols-[1rem_auto_minmax(0,1fr)_auto] items-center gap-2.5"
        >
          <span
            className={cn(
              typeClass("caption"),
              "text-right text-muted-foreground tabular-nums",
            )}
          >
            {index + 1}
          </span>
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: tintOf(index) }}
          />
          <span className={cn(typeClass("body"), "truncate text-foreground")}>
            {topic.label}
          </span>
          <span
            className={cn(
              typeClass("body"),
              "text-right text-muted-foreground tabular-nums",
            )}
          >
            {topic.share}%
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Donut + legend, the whole visual payload of the panel — shared by both
 *  states so "locked" previews the actual layout, not just the chart. */
function DonutAndLegend({ ghost = false }: { readonly ghost?: boolean }) {
  return (
    <div className="grid grid-cols-1 items-center gap-x-6 gap-y-2 sm:grid-cols-[196px_minmax(0,1fr)] md:grid-cols-1 xl:grid-cols-[196px_minmax(0,1fr)]">
      <TopicDonut data={MOCK_TOPICS} ghost={ghost} />
      <TopicLegend data={MOCK_TOPICS} />
    </div>
  );
}

function EnableModelSheet({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const reason = MOCK_UNAVAILABLE_REASON;
  const copy = REASON_COPY[reason] ?? REASON_COPY.model_artifact_missing;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Enable topic categorization</SheetTitle>
          <SheetDescription>
            Topic categorization runs entirely on-device: a small (~30 MB) local
            classifier, no network calls, no evidence leaves this machine.
          </SheetDescription>
        </SheetHeader>
        <SheetBody className="flex flex-col gap-6 pt-1">
          <Banner status="info">
            <BannerTitle>{copy?.headline}</BannerTitle>
            <BannerDescription>
              Reason: <span className="font-mono">{reason}</span>
            </BannerDescription>
          </Banner>
          <ol className="flex flex-col gap-5">
            {copy?.steps.map((step, index) => (
              <li key={step.label} className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className={cn(
                    typeClass("micro"),
                    "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-hover text-foreground tabular-nums",
                  )}
                  style={{ fontVariationSettings: fontWeights.semibold }}
                >
                  {index + 1}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <p className={cn(typeClass("body"), "text-foreground")}>
                    <span className="sr-only">Step {index + 1}: </span>
                    {step.label}
                  </p>
                  {step.value === undefined ? null : (
                    <InputCopy value={step.value} size="compact" />
                  )}
                </div>
              </li>
            ))}
          </ol>
        </SheetBody>
        <SheetFooter>
          <Button asChild variant="primary" leadingIcon={Download}>
            <a
              href="https://github.com/ChmaraX/forensix#topic-classification"
              target="_blank"
              rel="noreferrer"
            >
              Full setup instructions on GitHub
            </a>
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/** "Candidate" qualifier for the panel title, with its explanation. */
function CandidateBadge() {
  return (
    <TermTooltip
      content={
        <TermExplanation technical="Topic Candidate (ranked)">
          A ranked suggestion from the on-device topic classifier — an inference
          over recorded URLs, not a recorded fact.
        </TermExplanation>
      }
    >
      <Badge size="compact" tabIndex={0} className="cursor-help">
        Candidate
      </Badge>
    </TermTooltip>
  );
}

export function TopicCategorizationCard({
  state,
  className,
}: {
  readonly state: TopicState;
  readonly className?: string;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const reason = REASON_COPY[MOCK_UNAVAILABLE_REASON];
  return (
    <Panel className={className}>
      {/* No jump link: there is no Topic page to open yet, and a link
          pointing nowhere is worse than none. */}
      <SectionHeader
        title="Topic categorization"
        badges={<CandidateBadge />}
        description="Ranked topic Candidates, by share of classified URLs."
      />
      <div className="flex flex-1 flex-col justify-center px-4 pt-1 pb-4">
        {state === "complete" ? (
          <DonutAndLegend />
        ) : (
          <div className="relative">
            {/* Ghost preview: the same donut + legend with example
                proportions, desaturated, blurred and dimmed — the locked
                card on top makes plain these are not this Case's numbers. */}
            <div
              aria-hidden="true"
              className="pointer-events-none opacity-40 blur-[3px] grayscale select-none"
            >
              <DonutAndLegend ghost />
            </div>
            <div className="absolute inset-0 flex items-center justify-center p-2">
              <Elevated
                offset={1}
                className="flex max-w-[300px] flex-col items-center gap-3 rounded-xl px-5 py-4 text-center"
              >
                <span
                  aria-hidden="true"
                  className="inline-flex size-8 items-center justify-center rounded-lg bg-hover text-muted-foreground"
                >
                  <Lock size={16} strokeWidth={1.5} />
                </span>
                <div className="flex flex-col items-center gap-1.5">
                  <EvidenceBadge state="unavailable" size="compact">
                    unavailable
                  </EvidenceBadge>
                  <p
                    className={cn(typeClass("subtitle"), "text-foreground")}
                    style={{ fontVariationSettings: fontWeights.semibold }}
                  >
                    {reason?.headline ?? "Topic model not available"}
                  </p>
                  <p
                    className={cn(
                      typeClass("caption"),
                      "text-muted-foreground",
                    )}
                  >
                    Download the local model to enable topic categorization.
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="compact"
                  onClick={() => {
                    setSheetOpen(true);
                  }}
                >
                  Show me how
                </Button>
              </Elevated>
            </div>
          </div>
        )}
      </div>
      <EnableModelSheet open={sheetOpen} onOpenChange={setSheetOpen} />
    </Panel>
  );
}
