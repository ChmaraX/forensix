/**
 * Overview "Topic categorization" line — one compact row saying the topic
 * Candidates are unavailable and why, with "How to enable" opening a Sheet of
 * setup steps.
 *
 * Topic output is Candidate data: a ranked inference over recorded URLs, not
 * a recorded fact. The row says so with a "Candidate" badge and its
 * explanation, and none of it ever feeds a figure elsewhere on the Overview.
 *
 * NOT WIRED YET: the classifier's state is fixed to "unavailable" with
 * `UNAVAILABLE_REASON` until the server exposes a `topic-status` route
 * backed by `TopicCandidateSummary` (see
 * `core/src/history-topic-classification.ts`). A real result then needs its
 * own ranked list here — the old donut drew example data and is gone.
 */
import { useId, useState } from "react";

import { TermExplanation, TermTooltip } from "@/components/term";
import { Badge } from "@/components/ui/badge";
import { Banner, BannerDescription, BannerTitle } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { InputCopy } from "@/components/ui/input-copy";
import { Panel, PanelTitle } from "@/components/panel";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ExternalLinkIcon } from "@/lib/app-icons";
import { fontWeights } from "@/lib/font-weight";
import { SizeProvider, typeClass } from "@/lib/size-context";
import { cn } from "@/lib/utils";

/** Why the classifier is unavailable — fixed until `topic-status` exists. */
const UNAVAILABLE_REASON =
  "model_artifact_missing" as const; /* try: model_runtime_unavailable */

/** The project's setup notes (opens outside the dashboard, in a new tab). */
const SETUP_URL = "https://github.com/ChmaraX/forensix#topic-classification";

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
  {
    readonly headline: string;
    /** The headline as the tail of "unavailable - …" on the Overview row. */
    readonly short: string;
    /** What the reason means for this Case, in words (the banner's
     *  description; the raw reason code stays out of the copy). */
    readonly consequence: string;
    readonly steps: readonly SetupStep[];
  }
> = {
  model_artifact_missing: {
    headline: "Topic model not downloaded",
    short: "model not downloaded",
    consequence:
      "No topic suggestions until the model is downloaded and the analysis re-run.",
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
    short: "runtime not installed",
    consequence:
      "No topic suggestions until the runtime is installed and the analysis re-run.",
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
    short: "model failed to load",
    consequence:
      "No topic suggestions until the model loads and the analysis is re-run.",
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
    short: "classification failed mid-run",
    consequence: "No topic suggestions until the analysis is re-run.",
    steps: [RERUN],
  },
};

function EnableModelSheet({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const reason = UNAVAILABLE_REASON;
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
            <BannerDescription>{copy?.consequence}</BannerDescription>
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
        {/* The one outbound link: secondary (nothing here is the page's
            main action in a read-only tool), with its address in words. */}
        <SheetFooter className="items-center justify-between gap-4">
          <p
            className={cn(
              typeClass("caption"),
              "min-w-0 font-mono break-all text-muted-foreground",
            )}
            title={SETUP_URL}
          >
            {SETUP_URL.replace(/^https:\/\//, "")}
          </p>
          <Button asChild variant="secondary" trailingIcon={ExternalLinkIcon}>
            <a href={SETUP_URL} target="_blank" rel="noreferrer">
              Setup instructions
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
          A ranked suggestion from the on-device topic classifier - an inference
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

/**
 * The whole panel on one line: title and Candidate badge, the unavailable
 * state with its reason, and "How to enable". Wraps below `sm`.
 */
export function TopicCategorizationLine({
  className,
}: {
  readonly className?: string;
}) {
  const titleId = useId();
  const [sheetOpen, setSheetOpen] = useState(false);
  const reason =
    REASON_COPY[UNAVAILABLE_REASON] ?? REASON_COPY.model_artifact_missing;
  return (
    // No jump link: there is no Topic page to open yet.
    <Panel
      role="region"
      aria-labelledby={titleId}
      className={cn(
        "flex-row flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3",
        className,
      )}
    >
      <PanelTitle id={titleId}>Topic categorization</PanelTitle>
      <CandidateBadge />
      <p className={cn(typeClass("body"), "min-w-0 text-muted-foreground")}>
        unavailable - {reason?.short ?? "model not available"}
      </p>
      <SizeProvider size="compact">
        <Button
          variant="secondary"
          size="compact"
          className="ml-auto"
          onClick={() => {
            setSheetOpen(true);
          }}
        >
          How to enable
        </Button>
      </SizeProvider>
      <EnableModelSheet open={sheetOpen} onOpenChange={setSheetOpen} />
    </Panel>
  );
}
