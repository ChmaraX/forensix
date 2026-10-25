/**
 * The row sheet's "Related" block: links from one row to other pages,
 * filtered by a value the row records exactly (related.ts) - its host in
 * Sites, its day in the Timeline, visits to a URL it records in History.
 * Nothing is inferred: a link appears only when the exact value matches.
 *
 * Each link is a real `<a href="#/…">`, so it opens in a new tab too, and
 * Back returns to this row with its sheet open.
 */
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import { ChevronRightIcon } from "@/lib/app-icons";
import { fontWeights } from "@/lib/font-weight";
import { useSize } from "@/lib/size-context";
import { cn } from "@/lib/utils";
import { caseTimeZone, exactVisitsOf } from "../case-reads.js";
import { PAGES } from "../pages.js";
import { formatLocation } from "../router.js";
import {
  dayLinkOf,
  hostLinkOf,
  visitedUrlsOf,
  visitLinksOf,
  type RelatedLink,
} from "../related.js";
import type { Finding } from "../types.js";
import { currentLocation, hrefFor } from "../view-state.js";
import { formatInstant } from "./finding-fields.js";
import { siteHostListed } from "./host-link.js";
import { RevealSwap } from "./list-states.js";

function formatTime(utc: string): string {
  const parts = formatInstant(utc);
  return parts === null ? utc : `${parts.date} ${parts.time} UTC`;
}

type Read =
  | { readonly state: "loading" }
  | {
      readonly state: "ready";
      readonly links: readonly RelatedLink[];
      /** The row is dated but its Case day could not be told: the Case's
       *  timezone read failed (a day is never guessed in UTC). */
      readonly dayUnknown: boolean;
    };

/** Resolves every link for the row: the host only when Sites lists it, the
 *  day in the Case's timezone, visits by exact URL. */
async function resolveLinks(
  row: Finding,
  signal: AbortSignal,
): Promise<{
  readonly links: readonly RelatedLink[];
  readonly dayUnknown: boolean;
}> {
  const host = hostLinkOf(row);
  const [timeZone, hostListed, visitLinks] = await Promise.all([
    // The one Case zone, or `undefined` when its read failed.
    caseTimeZone().catch(() => undefined),
    // The one Sites host-list rule (`host-link.tsx`), shared with the
    // cell links.
    host === null ? Promise.resolve(false) : siteHostListed(host.value),
    Promise.all(
      visitedUrlsOf(row).map((source) =>
        exactVisitsOf(source.url, signal)
          .then(({ visits, more }) =>
            visitLinksOf(source, row.findingKind, visits, formatTime, more),
          )
          .catch(() => []),
      ),
    ),
  ]);
  const day = timeZone === undefined ? null : dayLinkOf(row, timeZone);
  return {
    links: [
      ...(host !== null && hostListed ? [host] : []),
      ...(day === null ? [] : [day]),
      ...visitLinks.flat(),
    ],
    dayUnknown: timeZone === undefined && dayLinkOf(row, null) !== null,
  };
}

function RelatedRow({ link }: { readonly link: RelatedLink }) {
  const size = useSize();
  const destination = PAGES[link.page].label;
  return (
    <div className="grid grid-cols-1 items-center gap-x-4 py-1.5 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
      <dt className="flex min-w-0 flex-col pt-1 sm:pt-0">
        <span className={cn(size.type.body, "text-muted-foreground")}>
          {link.label}
        </span>
        {/* The raw field the value was read from, as the Fields list
            below captions it. */}
        {link.field === null ? null : (
          <span
            className={cn(
              size.type.caption,
              "truncate font-mono text-muted-foreground",
            )}
          >
            {link.field}
          </span>
        )}
      </dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-x-2">
        <Button
          asChild
          variant="ghost"
          size="compact"
          trailingIcon={ChevronRightIcon}
          className={cn(
            "-ml-3 min-w-0 justify-start text-foreground",
            link.mono && "font-mono",
          )}
        >
          <a
            href={hrefFor(link.page, link.extras)}
            aria-label={`${link.action}: ${link.value}`}
            title={link.action}
          >
            {link.value}
          </a>
        </Button>
        <span
          className={cn(size.type.caption, "shrink-0 text-muted-foreground")}
          aria-hidden="true"
        >
          in {destination}
        </span>
      </dd>
    </div>
  );
}

/** The Related section for one row (rendered by `RowSheet`). */
export function RelatedLinks({ row }: { readonly row: Finding }) {
  const size = useSize();
  const [read, setRead] = useState<Read>({ state: "loading" });

  useEffect(() => {
    const abort = new AbortController();
    setRead({ state: "loading" });
    resolveLinks(row, abort.signal)
      .then(({ links, dayUnknown }) => {
        if (!abort.signal.aborted) {
          setRead({ state: "ready", links, dayUnknown });
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) {
          setRead({ state: "ready", links: [], dayUnknown: false });
        }
      });
    return () => {
      abort.abort();
    };
  }, [row]);

  // A link to the view already on show (Sites on this host, the Timeline
  // on this day) goes nowhere new: left out.
  const here = formatLocation({ ...currentLocation(), row: null });
  const links =
    read.state === "loading"
      ? []
      : read.links.filter((link) => hrefFor(link.page, link.extras) !== here);

  // A kind with nothing it could link (no host, day or visited URL) shows
  // no section at all, rather than an empty one.
  const possible =
    hostLinkOf(row) !== null ||
    dayLinkOf(row, null) !== null ||
    visitedUrlsOf(row).length > 0;
  if (!possible) {
    return null;
  }

  return (
    <section aria-label="Related evidence" aria-busy={read.state === "loading"}>
      <h3
        className={cn(size.type.subtitle, "mb-1 text-foreground")}
        style={{ fontVariationSettings: fontWeights.semibold }}
      >
        Related
      </h3>
      <RevealSwap
        loading={read.state === "loading"}
        skeleton={
          <div className="flex flex-col gap-2 py-1.5">
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-7 w-2/3" />
          </div>
        }
      >
        {read.state === "loading" ? null : (
          <>
            {links.length === 0 ? (
              read.dayUnknown ? null : (
                <p className={cn(size.type.body, "py-2 text-muted-foreground")}>
                  No related evidence with the same host, day or URL.
                </p>
              )
            ) : (
              <dl className="reveal-items flex flex-col divide-y divide-border">
                {links.map((link) => (
                  <RelatedRow key={link.key} link={link} />
                ))}
              </dl>
            )}
            {read.dayUnknown ? (
              <p
                className={cn(size.type.caption, "py-2 text-muted-foreground")}
              >
                The day link is unavailable: the Case's timezone could not be
                read.
              </p>
            ) : null}
          </>
        )}
      </RevealSwap>
    </section>
  );
}
