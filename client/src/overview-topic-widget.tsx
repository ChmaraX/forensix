/**
 * Overview "Topic categorization" line — one compact row saying whether the
 * Case holds topic Candidates (one `topic-candidates` row, `limit=1`):
 * available, none, or unavailable when the read failed. With none, "How to
 * enable" opens a Sheet of setup steps. The Case records no reason for an
 * empty result, so the line names none.
 *
 * Topic output is Candidate data: a ranked inference over recorded URLs, not
 * a recorded fact. The row says so with a "Candidate" badge and its
 * explanation, and none of it ever feeds a figure elsewhere on the Overview.
 *
 * The ranked list itself (and a classifier status with its reason) needs its
 * own route and panel; until then the line says only what one row proves.
 */
import { useCallback, useEffect, useId, useState } from "react";

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
import { callApi, isAbortError } from "./api.js";
import type { PageOf } from "./types.js";

/** The project's setup notes (opens outside the dashboard, in a new tab). */
const SETUP_URL = "https://github.com/ChmaraX/forensix#topic-classification";

/** One setup step: what to do, and — when the step is a command, a model id
 *  or a variable name — the exact text to copy. */
interface SetupStep {
  readonly label: string;
  readonly value?: string;
}

/** Everything the on-device classifier needs (core's
 *  `topic-candidates-onnx.ts`), in order. The Case does not record which
 *  step was missing, so the Sheet lists them all and names none. */
const SETUP_STEPS: readonly SetupStep[] = [
  {
    label: "Install the runtime",
    value: "npm install onnxruntime-node @huggingface/transformers",
  },
  { label: "Download the model", value: "minishlab/potion-base-8M" },
  {
    label: "Point this variable at the model folder",
    value: "FORENSIX_TOPIC_MODEL_DIR",
  },
  {
    label: "Re-run the analysis",
    value: "forensix analyse --case <dir>",
  },
];

/**
 * What the Case says about topic Candidates, from one `topic-candidates`
 * row (`limit=1`, every Commit State): `available` (at least one), `none`
 * (the read answered with none) or `unavailable` (the read failed - the
 * state is unknown, never "none").
 */
type TopicState = "loading" | "available" | "none" | "unavailable";

function useTopicState(): {
  readonly state: TopicState;
  readonly retry: () => void;
} {
  const [state, setState] = useState<TopicState>("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setState("loading");
    callApi<PageOf<unknown>>("topic-candidates", [["limit", "1"]], {
      signal: abort.signal,
    })
      .then((page) => {
        setState(page.items.length > 0 ? "available" : "none");
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          setState("unavailable");
        }
      });
    return () => {
      abort.abort();
    };
  }, [attempt]);
  const retry = useCallback(() => {
    setAttempt((count) => count + 1);
  }, []);
  return { state, retry };
}

/** The line's words for each state: what the Case holds, never why. */
const STATE_TEXT: Record<TopicState, string> = {
  loading: "checking…",
  available: "available",
  none: "none in this Case",
  unavailable: "unavailable - the topic read failed",
};

function EnableModelSheet({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
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
            <BannerTitle>No topic Candidates in this Case</BannerTitle>
            <BannerDescription>
              The Case does not record why: the classifier may not have been set
              up for the analysis, or it ran and suggested nothing. These steps
              produce topic Candidates on the next analysis.
            </BannerDescription>
          </Banner>
          <ol className="flex flex-col gap-5">
            {SETUP_STEPS.map((step, index) => (
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
 * The whole panel on one line: title and Candidate badge, what the Case
 * holds (available / none / unavailable), and "How to enable" when it holds
 * none, or Retry when the read failed. Wraps below `sm`.
 */
export function TopicCategorizationLine({
  className,
}: {
  readonly className?: string;
}) {
  const titleId = useId();
  const [sheetOpen, setSheetOpen] = useState(false);
  const { state, retry } = useTopicState();
  return (
    // No jump link: there is no Topic page to open yet.
    <Panel
      role="region"
      aria-labelledby={titleId}
      aria-busy={state === "loading"}
      className={cn(
        "flex-row flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3",
        className,
      )}
    >
      <PanelTitle id={titleId}>Topic categorization</PanelTitle>
      <CandidateBadge />
      <p
        className={cn(typeClass("body"), "min-w-0 text-muted-foreground")}
        aria-live="polite"
      >
        {STATE_TEXT[state]}
      </p>
      {state === "none" || state === "unavailable" ? (
        <SizeProvider size="compact">
          <Button
            variant="secondary"
            size="compact"
            className="ml-auto"
            onClick={() => {
              if (state === "none") {
                setSheetOpen(true);
              } else {
                retry();
              }
            }}
          >
            {state === "none" ? "How to enable" : "Retry"}
          </Button>
        </SizeProvider>
      ) : null}
      <EnableModelSheet open={sheetOpen} onOpenChange={setSheetOpen} />
    </Panel>
  );
}
