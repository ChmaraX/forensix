/**
 * Read-only Case dashboard (issue #171), browser entry point.
 *
 * This client contains no forensic logic and performs no Case writes. It only
 * renders what the read-only loopback API returns from the analyzer core. It
 * offers no control that could start or rerun ingest, analysis, or export.
 *
 * Presentation rules enforced here:
 *  - the Completeness Statement is rendered before any row;
 *  - TYPE is always the first column;
 *  - value / empty / absent / unavailable are shown as distinct words, never by
 *    color alone;
 *  - Candidates are never shown as factual summary tiles.
 */

export const CLIENT_IMPLEMENTATION_ISSUE = 171;

declare global {
  interface Window {
    __FORENSIX_TOKEN__?: string;
  }
}

type CommitState = "committed" | "wal_resident" | "journal_resident";

type FieldState =
  | {
      readonly state: "value";
      readonly value: unknown;
      readonly synthetic?: boolean;
    }
  | { readonly state: "absent" }
  | { readonly state: "unavailable"; readonly reason: string };

interface Finding {
  readonly recordType: "finding";
  readonly findingKind: string;
  readonly profile: string;
  readonly commitState: CommitState;
  readonly provenance: {
    readonly manifestPath?: string;
    readonly table?: string;
    readonly rowId?: string;
  };
  readonly fields: Readonly<Record<string, FieldState>>;
}

interface Page {
  readonly status: "ok";
  readonly items: readonly Finding[];
  readonly nextCursor: string | null;
  readonly limit: number;
}

interface CompletenessArtifact {
  readonly sourceId: string;
  readonly profile: string;
  readonly artifact: string;
  readonly databasePath: string;
  readonly outcome: "produced" | "absent" | "unavailable";
  readonly reason: string | null;
  readonly runId: string;
}

interface CompletenessStatement {
  readonly artifact: string;
  readonly attempted: number;
  readonly produced: number;
  readonly absent: number;
  readonly unavailable: number;
  readonly artifacts: readonly CompletenessArtifact[];
}

interface CaseCompleteness {
  readonly statements: readonly CompletenessStatement[];
}

interface CaseProfiles {
  readonly profiles: readonly string[];
}

interface ExtraFilter {
  readonly parameter: string;
  readonly label: string;
}

interface ArtifactConfig {
  readonly key: string;
  readonly label: string;
  readonly route: string;
  readonly completenessArtifact: string;
  readonly sorts: readonly string[];
  readonly extras: readonly ExtraFilter[];
}

const TOKEN = window.__FORENSIX_TOKEN__ ?? "";

const SIDECAR_STATES: readonly CommitState[] = [
  "wal_resident",
  "journal_resident",
];

const COMMIT_LABELS: Readonly<Record<CommitState, string>> = {
  committed: "committed",
  wal_resident: "sidecar — WAL-resident",
  journal_resident: "sidecar — rollback-journal-resident",
};

const ARTIFACTS: readonly ArtifactConfig[] = [
  {
    key: "history",
    label: "History",
    route: "history",
    completenessArtifact: "History",
    sorts: ["visit-time", "url", "duration", "profile"],
    extras: [
      {
        parameter: "view",
        label: "View (visits/activity/most-visited/durations)",
      },
      { parameter: "transition", label: "Transition" },
      { parameter: "from", label: "From (ISO instant)" },
      { parameter: "to", label: "To (ISO instant)" },
    ],
  },
  {
    key: "cookies",
    label: "Cookies",
    route: "cookies",
    completenessArtifact: "Cookies",
    sorts: [
      "host",
      "name",
      "creation-time",
      "expires-time",
      "last-access-time",
      "profile",
    ],
    extras: [
      { parameter: "host", label: "Host key" },
      { parameter: "same-site", label: "SameSite" },
    ],
  },
  {
    key: "credentials",
    label: "Credentials",
    route: "credentials",
    completenessArtifact: "Login Data",
    sorts: ["created-time", "last-used-time", "origin", "username", "profile"],
    extras: [],
  },
  {
    key: "top-sites",
    label: "Top Sites",
    route: "top-sites",
    completenessArtifact: "Top Sites",
    sorts: ["rank", "url", "title", "profile"],
    extras: [],
  },
];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  properties: Partial<
    Record<"className" | "textContent" | "type" | "value" | "title", string>
  > = {},
  children: readonly (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (properties.className !== undefined) {
    node.className = properties.className;
  }
  if (properties.textContent !== undefined) {
    node.textContent = properties.textContent;
  }
  if (properties.title !== undefined) {
    node.title = properties.title;
  }
  if (node instanceof HTMLInputElement) {
    if (properties.type !== undefined) {
      node.type = properties.type;
    }
    if (properties.value !== undefined) {
      node.value = properties.value;
    }
  }
  for (const child of children) {
    node.append(child);
  }
  return node;
}

async function callApi<T>(
  route: string,
  parameters: readonly (readonly [string, string])[],
): Promise<T> {
  const query = new URLSearchParams();
  for (const [name, value] of parameters) {
    if (value.length > 0) {
      query.append(name, value);
    }
  }
  const response = await fetch(`/api/${route}?${query.toString()}`, {
    method: "GET",
    cache: "no-store",
    headers: { "x-forensix-token": TOKEN },
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null && "message" in body
        ? String((body as { message: unknown }).message)
        : `Request failed (${String(response.status)})`;
    throw new Error(message);
  }
  return body as T;
}

function renderFieldCell(field: FieldState): HTMLTableCellElement {
  const cell = el("td");
  if (field.state === "absent") {
    cell.append(
      el("span", { className: "mark mark-absent", textContent: "absent" }),
    );
    return cell;
  }
  if (field.state === "unavailable") {
    cell.append(
      el("span", {
        className: "mark mark-unavailable",
        textContent: `unavailable — ${field.reason}`,
      }),
    );
    return cell;
  }
  const value = field.value;
  if (value === "") {
    cell.append(
      el("span", { className: "mark mark-empty", textContent: "(empty)" }),
    );
    return cell;
  }
  let text: string;
  if (value === null) {
    text = "null";
  } else if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    text = typeof record.utc === "string" ? record.utc : JSON.stringify(value);
  } else {
    text = String(value);
  }
  cell.append(el("span", { className: "mark mark-value", textContent: text }));
  return cell;
}

function collectColumns(rows: readonly Finding[]): readonly string[] {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row.fields)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  return columns;
}

function renderRowsTable(rows: readonly Finding[]): HTMLElement {
  if (rows.length === 0) {
    return el("p", {
      className: "muted",
      textContent: "No rows for this filter.",
    });
  }
  const columns = collectColumns(rows);
  const table = el("table", { className: "rows" });
  const head = el("tr");
  // TYPE is always the first column.
  head.append(el("th", { className: "col-type", textContent: "TYPE" }));
  head.append(el("th", { textContent: "PROFILE" }));
  head.append(el("th", { textContent: "COMMIT STATE" }));
  head.append(el("th", { textContent: "SOURCE ROW" }));
  for (const column of columns) {
    head.append(el("th", { textContent: column }));
  }
  const thead = el("thead", {}, [head]);
  const tbody = el("tbody");
  for (const row of rows) {
    const tr = el("tr");
    tr.append(
      el("td", { className: "col-type", textContent: row.findingKind }),
    );
    tr.append(el("td", { textContent: row.profile }));
    tr.append(
      el("td", {
        className: "mark mark-commit",
        textContent: COMMIT_LABELS[row.commitState],
      }),
    );
    const source = [
      row.provenance.manifestPath ?? "",
      row.provenance.table ?? "",
      row.provenance.rowId ?? "",
    ]
      .filter((part) => part.length > 0)
      .join(" · ");
    tr.append(el("td", { className: "muted", textContent: source }));
    for (const column of columns) {
      const field = row.fields[column];
      tr.append(
        field === undefined
          ? el("td", {}, [
              el("span", {
                className: "mark mark-absent",
                textContent: "absent",
              }),
            ])
          : renderFieldCell(field),
      );
    }
    tbody.append(tr);
  }
  table.append(thead, tbody);
  return table;
}

interface ListParameters {
  readonly config: ArtifactConfig;
  readonly commitStates: readonly CommitState[];
  readonly base: readonly (readonly [string, string])[];
  readonly heading: string;
}

/**
 * One keyset-paginated, single-commit-state list. Committed and sidecar rows
 * live in separate lists, so each list pins exactly one Commit State.
 */
function createList(parameters: ListParameters): HTMLElement {
  const section = el("section", { className: "list" });
  section.append(el("h4", { textContent: parameters.heading }));
  const controls = el("div", { className: "list-controls" });
  const commitSelect = el("select");
  for (const state of parameters.commitStates) {
    const option = document.createElement("option");
    option.value = state;
    option.textContent = COMMIT_LABELS[state];
    commitSelect.append(option);
  }
  if (parameters.commitStates.length > 1) {
    const label = el("label", {
      className: "inline",
      textContent: "Commit State ",
    });
    label.append(commitSelect);
    controls.append(label);
  }
  const status = el("div", { className: "list-status", textContent: "" });
  const body = el("div", { className: "list-body" });
  const moreButton = el("button", { textContent: "Load more" });
  moreButton.type = "button";
  moreButton.style.display = "none";
  section.append(controls, status, body, moreButton);

  let cursor: string | null = null;
  let accumulated: Finding[] = [];

  const load = async (reset: boolean): Promise<void> => {
    if (reset) {
      cursor = null;
      accumulated = [];
    }
    const commitState = commitSelect.value;
    const request: (readonly [string, string])[] = [
      ...parameters.base,
      ["commit-state", commitState],
    ];
    if (cursor !== null) {
      request.push(["after", cursor]);
    }
    status.textContent = "Loading…";
    try {
      const page = await callApi<Page>(parameters.config.route, request);
      accumulated = [...accumulated, ...page.items];
      cursor = page.nextCursor;
      body.replaceChildren(renderRowsTable(accumulated));
      status.textContent = `${String(accumulated.length)} row(s) shown${
        cursor === null ? "" : "; more available"
      }.`;
      moreButton.style.display = cursor === null ? "none" : "inline-block";
    } catch (error) {
      status.textContent =
        error instanceof Error ? `Error: ${error.message}` : "Request failed.";
      moreButton.style.display = "none";
    }
  };

  moreButton.addEventListener("click", () => {
    void load(false);
  });
  commitSelect.addEventListener("change", () => {
    void load(true);
  });
  void load(true);
  return section;
}

function renderCompleteness(
  statement: CompletenessStatement | undefined,
): HTMLElement {
  const panel = el("section", { className: "completeness" });
  panel.append(el("h4", { textContent: "Completeness Statement" }));
  if (statement === undefined || statement.attempted === 0) {
    panel.append(
      el("p", {
        className: "muted",
        textContent: "No analyzed artifacts for this Case yet.",
      }),
    );
    return panel;
  }
  const summary = el("p", {
    className: "completeness-summary",
    textContent:
      `Attempted ${String(statement.attempted)} · ` +
      `produced ${String(statement.produced)} · ` +
      `absent ${String(statement.absent)} · ` +
      `unavailable ${String(statement.unavailable)}`,
  });
  panel.append(summary);
  const table = el("table", { className: "rows" });
  const head = el("tr");
  for (const column of [
    "OUTCOME",
    "SOURCE",
    "PROFILE",
    "DATABASE",
    "REASON",
    "RUN",
  ]) {
    head.append(el("th", { textContent: column }));
  }
  const tbody = el("tbody");
  for (const artifact of statement.artifacts) {
    const tr = el("tr");
    tr.append(
      el("td", {
        className: `mark mark-outcome-${artifact.outcome}`,
        textContent: artifact.outcome,
      }),
    );
    tr.append(el("td", { textContent: artifact.sourceId }));
    tr.append(el("td", { textContent: artifact.profile }));
    tr.append(
      el("td", { className: "muted", textContent: artifact.databasePath }),
    );
    tr.append(el("td", { textContent: artifact.reason ?? "—" }));
    tr.append(el("td", { className: "muted", textContent: artifact.runId }));
    tbody.append(tr);
  }
  table.append(el("thead", {}, [head]), tbody);
  panel.append(table);
  return panel;
}

function collectFilters(
  config: ArtifactConfig,
  profiles: readonly string[],
): {
  readonly element: HTMLElement;
  read(): { readonly base: readonly (readonly [string, string])[] };
  onApply(handler: () => void): void;
} {
  const bar = el("div", { className: "filters" });

  const search = el("input", { type: "search", value: "" });
  const searchLabel = el("label", {
    className: "inline",
    textContent: "Search ",
  });
  searchLabel.append(search);

  const sortSelect = el("select");
  for (const sort of config.sorts) {
    const option = document.createElement("option");
    option.value = sort;
    option.textContent = sort;
    sortSelect.append(option);
  }
  const sortLabel = el("label", { className: "inline", textContent: "Sort " });
  sortLabel.append(sortSelect);

  const directionSelect = el("select");
  for (const direction of ["desc", "asc"]) {
    const option = document.createElement("option");
    option.value = direction;
    option.textContent = direction;
    directionSelect.append(option);
  }
  const directionLabel = el("label", {
    className: "inline",
    textContent: "Direction ",
  });
  directionLabel.append(directionSelect);

  const limit = el("input", { type: "number", value: "25" });
  limit.min = "1";
  limit.max = "100";
  const limitLabel = el("label", {
    className: "inline",
    textContent: "Limit ",
  });
  limitLabel.append(limit);

  bar.append(searchLabel, sortLabel, directionLabel, limitLabel);

  const extraInputs = new Map<string, HTMLInputElement>();
  for (const extra of config.extras) {
    const input = el("input", { type: "text", value: "" });
    const label = el("label", {
      className: "inline",
      textContent: `${extra.label} `,
    });
    label.append(input);
    extraInputs.set(extra.parameter, input);
    bar.append(label);
  }

  const profileBox = el("fieldset", { className: "profiles" });
  profileBox.append(el("legend", { textContent: "Profiles (multi-select)" }));
  const profileInputs = new Map<string, HTMLInputElement>();
  if (profiles.length === 0) {
    profileBox.append(
      el("span", { className: "muted", textContent: "No Profiles." }),
    );
  }
  for (const profile of profiles) {
    const checkbox = el("input", { type: "checkbox", value: profile });
    profileInputs.set(profile, checkbox);
    const label = el("label", { className: "inline" }, [
      checkbox,
      ` ${profile}`,
    ]);
    profileBox.append(label);
  }
  bar.append(profileBox);

  const apply = el("button", { textContent: "Apply filters" });
  apply.type = "button";
  bar.append(apply);

  return {
    element: bar,
    read() {
      const base: (readonly [string, string])[] = [
        ["search", search.value.trim()],
        ["sort", sortSelect.value],
        ["direction", directionSelect.value],
        ["limit", limit.value.trim()],
      ];
      for (const [parameter, input] of extraInputs) {
        base.push([parameter, input.value.trim()]);
      }
      for (const [profile, checkbox] of profileInputs) {
        if (checkbox.checked) {
          base.push(["profile", profile]);
        }
      }
      return { base };
    },
    onApply(handler: () => void) {
      apply.addEventListener("click", handler);
    },
  };
}

async function renderArtifactTab(
  config: ArtifactConfig,
  container: HTMLElement,
): Promise<void> {
  container.replaceChildren(el("p", { textContent: "Loading…" }));
  let completeness: CaseCompleteness;
  let profiles: CaseProfiles;
  try {
    [completeness, profiles] = await Promise.all([
      callApi<CaseCompleteness>("completeness", []),
      callApi<CaseProfiles>("profiles", []),
    ]);
  } catch (error) {
    container.replaceChildren(
      el("p", {
        className: "mark mark-unavailable",
        textContent:
          error instanceof Error
            ? `Error: ${error.message}`
            : "Request failed.",
      }),
    );
    return;
  }

  const statement = completeness.statements.find(
    (entry) => entry.artifact === config.completenessArtifact,
  );

  const filters = collectFilters(config, profiles.profiles);
  const listsHost = el("div", { className: "lists" });

  const draw = (): void => {
    const { base } = filters.read();
    listsHost.replaceChildren(
      createList({
        config,
        commitStates: ["committed"],
        base,
        heading: "Committed rows",
      }),
      createList({
        config,
        commitStates: SIDECAR_STATES,
        base,
        heading: "Sidecar rows (WAL / rollback-journal)",
      }),
    );
  };
  filters.onApply(draw);

  container.replaceChildren();
  // Completeness always renders before any row.
  container.append(renderCompleteness(statement));
  container.append(filters.element);
  container.append(listsHost);
  draw();
}

function renderLegend(): HTMLElement {
  const legend = el("section", { className: "legend" });
  legend.append(el("h4", { textContent: "How to read values" }));
  const list = el("ul");
  const entries: readonly [string, string][] = [
    ["value", "a recorded value"],
    ["(empty)", "a present but empty value"],
    ["absent", "the field does not exist for this row"],
    [
      "unavailable — reason",
      "the value could not be established, with a typed reason",
    ],
  ];
  for (const [term, meaning] of entries) {
    list.append(
      el("li", {}, [
        el("span", { className: "mark", textContent: term }),
        ` — ${meaning}`,
      ]),
    );
  }
  legend.append(list);
  return legend;
}

function styles(): string {
  return `
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body { font: 14px/1.5 system-ui, sans-serif; margin: 0; }
    header { padding: 12px 16px; border-bottom: 2px solid currentColor; }
    header .banner { font-weight: 700; }
    header .readonly { font-weight: 600; }
    nav { display: flex; gap: 8px; padding: 8px 16px; flex-wrap: wrap; }
    nav button { padding: 6px 12px; cursor: pointer; }
    nav button[aria-current="true"] { text-decoration: underline; font-weight: 700; }
    main { padding: 0 16px 32px; }
    .filters { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; margin: 12px 0; }
    label.inline { display: inline-flex; align-items: center; gap: 4px; }
    fieldset.profiles { display: flex; flex-wrap: wrap; gap: 10px; max-width: 100%; }
    table.rows { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 13px; }
    table.rows th, table.rows td { border: 1px solid #8888; padding: 4px 8px; text-align: left; vertical-align: top; }
    .col-type { font-weight: 700; }
    .muted { opacity: 0.7; }
    .mark { font-variant: small-caps; }
    .mark-empty { font-style: italic; text-decoration: underline dotted; }
    .mark-absent { font-style: italic; }
    .mark-unavailable { font-weight: 700; text-decoration: underline; }
    .mark-outcome-produced { font-weight: 700; }
    .mark-outcome-absent { font-style: italic; }
    .mark-outcome-unavailable { font-weight: 700; text-decoration: underline; }
    .mark-commit { font-variant: small-caps; }
    section.completeness, section.legend { border: 1px solid #8888; padding: 8px 12px; margin: 12px 0; }
    section.list { margin: 16px 0; }
    .list-status { margin: 4px 0; }
    button { cursor: pointer; }
  `;
}

function main(): void {
  const root = document.getElementById("app");
  if (root === null) {
    return;
  }
  const styleTag = document.createElement("style");
  styleTag.textContent = styles();
  document.head.append(styleTag);

  const header = el("header");
  header.append(
    el("div", {
      className: "banner",
      textContent: "ForensiX — read-only Case dashboard",
    }),
  );
  header.append(
    el("div", {
      className: "readonly",
      textContent:
        "Read-only surface. It cannot start or rerun ingest, analysis, or export.",
    }),
  );

  const nav = el("nav");
  const main = el("main");
  const buttons = new Map<string, HTMLButtonElement>();

  const select = (config: ArtifactConfig): void => {
    for (const [key, button] of buttons) {
      button.setAttribute(
        "aria-current",
        key === config.key ? "true" : "false",
      );
    }
    void renderArtifactTab(config, main);
  };

  for (const config of ARTIFACTS) {
    const button = el("button", { textContent: config.label });
    button.type = "button";
    button.addEventListener("click", () => {
      select(config);
    });
    buttons.set(config.key, button);
    nav.append(button);
  }

  root.replaceChildren(header, nav, renderLegend(), main);
  const first = ARTIFACTS[0];
  if (first !== undefined) {
    select(first);
  }
}

main();

export {};
