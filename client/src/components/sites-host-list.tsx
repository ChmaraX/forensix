/**
 * The Sites master list: an FF CardGroup of inline cards, one per observed
 * host, ordered by how much saved evidence it carries (one fluid hover
 * highlight; the selected host holds the selection fill). Each card's
 * summary counts the host's saved rows per kind - every kind core's
 * `site-hosts` groups - never summing in recovered ones.
 */
import { Panel, PanelHeader, PanelTitle } from "@/components/panel";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardGroup,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import { SearchIcon } from "@/lib/app-icons";
import { useShape } from "@/lib/shape-context";
import { SizeProvider, typeClass } from "@/lib/size-context";
import { cn } from "@/lib/utils";

import type { SiteHost } from "../types.js";
import { EmptyRows } from "./data-table.js";
import { SiteAvatar } from "./finding-fields.js";
import { FilterTextField } from "./filters.js";
import { ErrorRows } from "./list-states.js";
import { CARD_TITLE_CLEAR, Count, plural } from "./page-kit.js";
import { hostSummary, savedTotalOf } from "./site-kinds.js";

function HostListSkeleton() {
  return (
    <div role="status" className="reveal-items flex flex-col gap-1 p-1">
      <span className="sr-only">Loading observed hosts</span>
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <div key={index} className="flex h-[60px] items-center gap-2.5 px-3">
          <Skeleton className="size-7 rounded-md" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-3/5" />
            <Skeleton className="h-2.5 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** The card's accessible name (also how "All hosts" finds it again). */
export function hostCardLabel(host: SiteHost): string {
  return `Show evidence for ${host.host}: ${plural(savedTotalOf(host), "saved row", "saved rows")}`;
}

/**
 * The master list: an FF CardGroup of inline cards, one per host. The fluid
 * highlight previews the host under the pointer; the selected host keeps the
 * selection fill and its CardTitle gains weight without reflow (FF's own
 * ghost-span title). The avatar holds the host's recovered favicon when the
 * Case has one (`site-favicons`), else its letter.
 */
export function HostList({
  hosts,
  loading,
  error,
  onRetry,
  search,
  onSearch,
  selected,
  onSelect,
  icons,
  className,
  complete,
}: {
  readonly hosts: readonly SiteHost[];
  /** False when the read stopped at its page cap. */
  readonly complete: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onRetry: () => void;
  readonly search: string;
  readonly onSearch: (value: string) => void;
  readonly selected: string | null;
  readonly onSelect: (host: string) => void;
  readonly icons: ReadonlyMap<string, string>;
  readonly className?: string;
}) {
  const shape = useShape();
  return (
    <Panel
      role="region"
      aria-labelledby="sites-hosts-title"
      className={cn("overflow-clip md:sticky md:top-16", className)}
    >
      <PanelHeader className="items-center pb-3">
        <div className="flex items-center gap-2">
          <PanelTitle id="sites-hosts-title">Observed hosts</PanelTitle>
          <Count>
            {`${hosts.length.toLocaleString("en-US")}${complete ? "" : "+"}`}
          </Count>
        </div>
      </PanelHeader>
      <SizeProvider size="compact">
        <div className="border-b border-border px-3 pb-3">
          <FilterTextField
            label="Search observed hosts"
            icon={SearchIcon}
            placeholder="Search hosts"
            value={search}
            onCommit={onSearch}
            className="w-full"
          />
        </div>
      </SizeProvider>
      {error !== null ? (
        <ErrorRows
          title="The observed hosts could not be loaded."
          message={error}
          onRetry={onRetry}
        />
      ) : loading && hosts.length === 0 ? (
        <HostListSkeleton />
      ) : hosts.length === 0 ? (
        <EmptyRows
          message={
            search.trim() === ""
              ? "No observed hosts in this Case."
              : `No observed host contains "${search.trim()}".`
          }
          action={
            search.trim() === "" ? undefined : (
              <Button
                variant="tertiary"
                size="compact"
                onClick={() => {
                  onSearch("");
                }}
              >
                Clear search
              </Button>
            )
          }
        />
      ) : (
        <div className="scroll-fade p-1 md:max-h-[calc(100dvh-13rem)] md:overflow-y-auto">
          <SizeProvider size="compact">
            <CardGroup orientation="inline">
              {hosts.map((item) => (
                <Card
                  key={item.host}
                  label={hostCardLabel(item)}
                  selected={selected === item.host}
                  onClick={() => {
                    onSelect(item.host);
                  }}
                  // A card in a group has no corner of its own, so its
                  // keyboard ring was square around the rounded selection
                  // fill; the fill's radius gives the ring the same corner.
                  className={shape.container}
                >
                  <SiteAvatar host={item.host} src={icons.get(item.host)} />
                  {/* The total (the list's order) is no unlabelled number
                      beside the card: it leads the summary's tooltip, and
                      the summary gets the width - up to two lines, so a
                      host with several kinds reads whole. */}
                  <CardHeader>
                    <CardTitle className={CARD_TITLE_CLEAR} title={item.host}>
                      {item.host}
                    </CardTitle>
                    <CardDescription
                      className={cn(typeClass("caption"), "line-clamp-2")}
                      title={`${plural(savedTotalOf(item), "saved row", "saved rows")}: ${hostSummary(item)}`}
                    >
                      {hostSummary(item)}
                    </CardDescription>
                  </CardHeader>
                </Card>
              ))}
            </CardGroup>
          </SizeProvider>
        </div>
      )}
    </Panel>
  );
}
