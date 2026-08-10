# Research: Examiner annotations vs tool-derived assertions, and audit-trail expectations (ForensiX v2)

Every claim below is tagged **CONFIRMED** (URL + verbatim quote from a live fetch) or **STILL-UNKNOWN** (could not be verified from a primary source in this pass). No claim is inferred silently.

---

## Q1 — How established tools model examiner annotations vs tool-derived assertions

### 1.1 Autopsy / The Sleuth Kit

**CONFIRMED — vocabulary: "Tagging (or Bookmarking)", "Tag and Comment", "Annotations" viewer.**
> "Tagging (or Bookmarking) allows you to create a reference to a file or object and easily find it later or include it in a report. Tagging is also used by the central repository to mark items as notable. You can add comments to files and results using tags or through the central repository."
> — http://sleuthkit.org/autopsy/docs/user-docs/4.23.0/tagging_page.html (HTTP 200)

**CONFIRMED — the tag target is an explicit choice between file object and derived result.**
> "When you tag a Blackboard artifact result, you have the choice to either: Tag File – use this when the file itself is of interest / Tag Result – use this when the result is of interest"
> — same URL. This is the exact distinction ForensiX cares about: Autopsy forces the examiner to say whether they are marking the *underlying object* or the *tool's derived assertion about it*.

**CONFIRMED — default tag vocabulary is fixed and includes a "notable" semantic.**
> "There are several default tag names: Bookmark - Default tag for marking files of interest; CAT-1 through CAT-5 - For law enforcement use; Follow Up - Default tag for marking files to follow up on; Notable item - Default tag for indicating that an item should be marked as notable in the central repository"
> — same URL.

**CONFIRMED — annotations carry examiner identity.**
> "Tags are associated with the account name of the user that tagged them."
> — same URL. There is also a UI option to "hide all tagged files and results ... that were tagged by other users."

**CONFIRMED — comments are multi-valued on tags, single-valued in the central repository.**
> "You can add multiple tags with comments to the same file or result." ... "If there was already a comment for this file it will appear in the dialog and can be changed - only one central repository comment can be stored at a time."
> — same URL.

**CONFIRMED — annotation lifetime is decoupled from the tag-name vocabulary.**
> "Note that deleting a tag does not remove it from any tagged items, and that tag will still be usable in any case where it has been used to tag an item."
> — same URL. i.e. the tag *instance* (the examiner's act) is durable independent of the tag *definition*.

**CONFIRMED — API shows annotations are first-class rows bound to an object id, in two distinct classes.**
> `ContentTag addContentTag(Content content, TagName tagName, String comment)` and `BlackboardArtifactTag addBlackboardArtifactTag(BlackboardArtifact artifact, TagName tagName, String comment)`
> — https://sleuthkit.org/autopsy/docs/api-docs/4.16.0/classorg_1_1sleuthkit_1_1autopsy_1_1casemodule_1_1services_1_1_tags_manager.html
> Two separate tag tables: one keyed to `Content` (file/object), one keyed to `BlackboardArtifact` (tool-derived result). Central-repo comments are keyed to a content object id: "contentId | the objectId of the Content which has had its central repository comment changed" — https://www.sleuthkit.org/autopsy/docs/api-docs/4.19.3/classorg_1_1sleuthkit_1_1autopsy_1_1casemodule_1_1events_1_1_commentChangedEvent... (see source table).

**CONFIRMED — "Interesting Items" is *tool-derived*, not examiner-recorded, and lives in a separate tree branch.**
> "The Interesting Files module allows you to automatically flag files and directories that match a set of rules." ... "Files that match any of the rules in the enabled rule sets will be shown in the Results section of the Tree Viewer under 'Interesting Items' and then the name of the rule set that matched."
> — https://sleuthkit.org/autopsy/docs/user-docs/4.23.0/interesting_files_identifier_page.html (HTTP 200)
> Key design signal: Autopsy keeps *rule-derived* flags ("Interesting Items", produced by an ingest module, provenance = rule set name shown in a "Category" column) in the Results/Blackboard tree, and keeps *examiner-applied* markings in a separate "Tags" tree. Same UI, different subtree, different data model.

**STILL-UNKNOWN — what happens to Autopsy tags when ingest is re-run or a data source is re-added.**
The Autopsy user docs I fetched do not state tag re-binding/orphaning behaviour on re-ingest or re-import. I found no primary doc page describing this. Do not assume tags survive a re-added data source; treat as untested.

### 1.2 Hindsight (obsidianforensics)

**CONFIRMED — Hindsight has no annotation model at all.** It is a pure parser/exporter. README option list is exhaustive: `-i/--input`, `-o/--output`, `-f/--format` (XLSX / SQLite / JSONL), `-c/--cache`, `-b/--browser_type`, `-l/--log`, `-h/--help`, `-t/--timezone`.
> "-l or --log | Location Hindsight should log to (will append if exists)"
> — https://github.com/obsidianforensics/hindsight (HTTP 200). A search of the fetched README for "annotat" returned **no matches**.
Implication for ForensiX: the closest peer tool in scope (Chrome-profile parsing) contributes *only* tool-derived rows; annotation is expected to happen downstream (e.g. after loading JSONL into Timesketch). ForensiX adding an annotation layer is a deliberate extension beyond Hindsight, not a copy of it.

### 1.3 Timesketch

**CONFIRMED — four distinct annotation concepts with explicit vocabulary: comment, star, tag, label, plus stories.**
> "You can comment events in your sketch. The comments are saved in your sketch, that means if you add a timeline to multiple sketches, the comments are only shown in the one sketch you made the comments."
> "Click the little star symbol in the Event List to star an event."
> "An event can have a list of tags. Those can be added via API, API client, CLI client or the Web UI. The tags are stored in the opensearch object in the field `tag`. This also means a data source, e.g. plaso could add tag(s) when parsing / processing data..."
> "In contrast to a tag, in older versions of Timesketch there was a label that could be added to an event. ... Those labels where stored in the database, not in the opensearch object. The concept of labels in events is slowly being deprecated..."
> — https://timesketch.org/guides/user/basic-concepts/ (HTTP 200)

**This is the single most important finding for Q1.** Timesketch's `tag` field is **explicitly shared between examiner and tool** — analyzers write tags into the same OpenSearch `tag` field an analyst writes to ("plaso could add tag(s) when parsing"). And Timesketch analyzers are documented as writing annotations programmatically:
> "It provides an easy to use API to programmatically do all the actions available in the UI, e.g. tagging events, star and create saved views etc."
> — same URL. So Timesketch **does not cleanly separate examiner assertion from tool assertion at the tag level.** Provenance of a tag is only recoverable by convention (analyzer tags like `bigquery-sha256-match`, `browser-search` are namespaced by string prefix). Confirmed example: "Any Timesketch event that has a `sha256_hash` field that matches ... will be tagged with `bigquery-sha256-match`". If ForensiX wants a clean split, Timesketch is a cautionary example, not a model.

**CONFIRMED — the annotation binding key in the data model is (sketch, searchindex, document_id).**
> `class Event(LabelMixin, StatusMixin, CommentMixin, BaseModel): """Implements the Event model.""" sketch_id = Column(Integer, ForeignKey("sketch.id")); searchindex_id = Column(Integer, ForeignKey("searchindex.id")); document_id = Column(Unicode(255))`
> — https://github.com/google/timesketch/blob/master/timesketch/models/sketch.py (HTTP 200)
The `Event` row in SQL exists **only** to hang comments/labels/status off an OpenSearch document. Comments and labels are relational; tags are in the document. Stories are separate SQL rows: `class Story(AccessControlMixin, LabelMixin, StatusMixin, CommentMixin, BaseModel): title, content, user_id, sketch_id` — same file. Stories are narrative-only, owned by a `user_id`.

**CONFIRMED — annotations are an exportable first-class category.**
> "You can export events that have comments, stars, or labels using `sketch export-only-with-annotations`."
> — https://timesketch.org/guides/user/cli-client/ ; PR description: "Exports only events that have at least one of the following: A comment / A star / A user-defined label (tag)" — https://github.com/google/timesketch/pull/3398

**STILL-UNKNOWN — Timesketch annotation survival on re-import.** The data model above binds annotations to `searchindex_id` + `document_id`, and the docs confirm comments do not follow a timeline into another sketch. Whether re-uploading the same plaso file produces the same `document_id` (and therefore reattaches comments) is **not documented** in anything I fetched. Do not assume idempotent document ids.

### 1.4 Velociraptor notebooks

**CONFIRMED — notebooks are the examiner-narrative surface, mixing prose and live queries in cells.**
> "Notebooks are interactive collaborative workspaces that combine markdown text with live VQL queries in a single document. ... A notebook is made up of cells. Each ... is either a [markdown cell] ... or a [VQL cell]."
> — https://docs.velociraptor.app/docs/notebooks/
> "Notebooks are typically used to track and post process one or more hunts or collaborate on an investigation. ... Velociraptor automatically creates a `hunt notebook`" — https://docs.velociraptor.app/docs/vql/notebooks/

Relevant design point: Velociraptor does **not** model per-row annotations at all. The examiner's contribution is a markdown cell *adjacent to* a query cell whose VQL text is itself the provenance record. Separation is achieved by cell type (markdown = human, VQL + its output = tool), and the tool-derived side is reproducible because the query is stored verbatim.

**CONFIRMED — notebook actions themselves are auditable.**
> "Some actions in the UI (Or in VQL notebooks) are important for server security. We call these actions `Auditable Actions`..."
> — https://www.velociraptor-docs.org/docs/deployment/security/ (HTTP 200)

### 1.5 X-Ways Forensics

**CONFIRMED — vocabulary: "report table" (the marking), plus free-text "comments" per object.**
> "In the directory browser of an evidence object, you can associate notable files with report tables. A report table is a user-defined (virtual) list of files, especially notable files. Files associated with report tables can then be easily included in the case report with all their metadata..."
> — https://documentation.help/WinHex-X-Ways/topic95.htm (retrieved via search index; **direct fetch returned HTTP 403 / Cloudflare challenge** — see source table)
> "XWF includes functionality to add items of interest to one or more groups, or report tables (RTs). RTs are the core of XWF's reporting functionality. In addition to adding an item to a RT, XWF also allows comments to be associated with objects in your case."
> — https://www.oreilly.com/library/view/x-ways-forensics-practitioners/9780124116054/xhtml/CHP008.html (secondary/commercial book, not vendor primary)

**CONFIRMED — report-table association is a filterable column, i.e. an attribute of the row.**
> "Report table [INV, FOR]: The name(s) of the report table(s) that the file or directory has been assigned to. Filter available."
> — https://documentation.help/WinHex-X-Ways/topic91.htm (search-index retrieval)

**STILL-UNKNOWN — X-Ways report-table persistence across volume-snapshot refresh / re-taking a snapshot.** Not confirmed; the vendor manual PDF (https://www.x-ways.com/winhex/manual.pdf) returned only 152 chars of extractable text through my fetcher, so I could not read §5.5 / §5.7 directly.

### 1.6 EnCase bookmarks

**STILL-UNKNOWN.** I found no publicly accessible OpenText/Guidance primary documentation for EnCase bookmark data model, bookmark-to-item binding, or re-processing behaviour in this pass. Do not cite EnCase bookmark semantics without a primary source.

### 1.7 Cross-tool synthesis for ForensiX (design-relevant, each element confirmed above)

| Tool | Examiner-annotation vocabulary | Bound to | Tool-derived side kept separate? |
|---|---|---|---|
| Autopsy | tag / bookmark / comment / "Annotations" tab | `Content` obj id **or** `BlackboardArtifact` id (two distinct tag tables); explicit "Tag File" vs "Tag Result" prompt | **Yes** — "Interesting Items" (rule-derived, Blackboard) live in Results tree; tags live in Tags tree |
| Hindsight | *(none)* | n/a | n/a — parser only |
| Timesketch | comment, star, label (deprecated), tag, story | `Event(sketch_id, searchindex_id, document_id)` for comments/labels; `tag` field inside the OpenSearch doc | **No** — analyzers write the same `tag` field as humans; only naming convention separates them |
| Velociraptor | markdown notebook cell | the notebook/hunt/flow, not a row | **Yes, structurally** — markdown cell vs VQL cell + stored query text |
| X-Ways | report table, comment | file/dir object in the volume snapshot (filterable column) | Partial — RT is examiner-assigned; not confirmed how tool-generated flags are distinguished |

**Design takeaway (confirmed-facts-only):** the only two tools that structurally separate human assertion from tool assertion are Autopsy (separate tables + separate tree) and Velociraptor (separate cell types). Autopsy's "Tag File vs Tag Result" prompt is the closest direct precedent for a Chrome-artifact tool that must distinguish "I mark this history row" from "I mark the tool's claim about this row."

---

## Q2 — Audit trail: required, recommended, or merely conventional?

### 2.1 Bottom line

**STILL-UNKNOWN / negative finding: I found no digital-forensics standard, best-practice document, or accreditation scheme that requires or explicitly recommends an *append-only or hash-chained/tamper-evident* audit log inside a forensic analysis tool.** What is required is *documentation sufficient for reproducibility and independent review* — a property about content and completeness, not about cryptographic tamper-evidence. The only hash-chain-for-audit-log requirement I found in this pass is from OWASP APTS (a penetration-testing standard, not digital forensics): "Implement append-only archive with immutable timestamps and SHA-256 hash chains for integrity verification" / "APTS-AR-012: Tamper-Evident Logging with Hash Chains" — https://owasp.org/APTS/standard/5_Auditability/Implementation_Guide.html. **That is not a forensics standard and should not be cited as one.**

### 2.2 SWGDE — CONFIRMED, and directly on point for the annotation/derivation split

**CONFIRMED — SWGDE explicitly separates the examiner's report from examination notes, and separates tool reports from the examination report.**
> "This document does not address writing examination notes on which the report is based."
> "A thorough examination report is written using documentation collected by the examiner, including photographs, drawings, case-notes, tool-generated content, etc. **Many forensic tools come with built-in reporting functionality that is specific to that tool's actions and results, but does not typically document the full scope of the examination. Tool reports may be considered supporting documentation to the examination report or referenced as an appendix.**"
> — SWGDE 18-Q-002 v1.0, https://www.swgde.org/documents/published-complete-listing/18-q-002-swgde-requirements-for-report-writing-in-digital-and-multimedia-forensics/ (HTTP 200)

**CONFIRMED — the reproducibility requirement, and its footnoted accreditation basis:**
> "Proper documentation is essential in providing individuals the ability to reproduce the forensic process and the results."
> Footnote 1: "**AR3125 7.5.1.3 requires technical records to be sufficiently detailed such that another reviewer possessing the relevant knowledge, skills, and abilities could evaluate what was done and interpret the data.**"
> — same URL. This is the accreditation hook (ANAB AR 3125, the ISO/IEC 17025 forensic-testing accreditation requirements). Note: it demands *detail sufficient for a second reviewer*, **not** tamper-evidence.

**CONFIRMED — contemporaneous notes are a named examiner competency:**
> "Ability to record contemporaneous notes while conducting the examination to ensure repeatability and reproducibility"
> — SWGDE 12-F-006 Core Competencies for Digital Forensics, https://www.swgde.org/documents/published-complete-listing/12-f-006-core-competencies-for-digital-forensics/ (HTTP 200)
"Contemporaneous" is a timing/append-order property. This is the strongest standards-side support for an append-only *notes* design — but it is stated as an examiner competency, not a tool requirement, and it says nothing about hashing.

**CONFIRMED — SWGDE does require record-keeping/audit-trail *content* in the archiving context:**
> "5.1.3 Record Keeping, Audit Trail, and Provenance ... It typically includes, for each archived item: Original source of the archived data; Circumstances surrounding the collection or generation of the archived data, including who, what, when, where, why, and how it was collected; Authorities for the collection, maintenance..."
> — SWGDE 19-F-003, https://www.swgde.org/wp-content/uploads/2023/11/2020-09-17-SWGDE-Best-Practices-for-Archiving-Digital-and-Multimedia-Evidence_v1.0.pdf
Note the field list: who / what / when / where / why / how. That is a usable field schema for a ForensiX audit record. **No tamper-evidence requirement attached.**

**CONFIRMED — SWGDE on in-house tools (directly relevant: ForensiX is an in-house tool):**
> "5.6 In-house developed tools. Tools and techniques developed in house that can influence the results of the examination should be tested by another person or entity competent in [the] underlying technology."
> — SWGDE 18-Q-001 v1.0, https://www.nist.gov/system/files/documents/2023/08/11/SWGDE%2018-Q-001-1.0%20Minimum%20Requirements%20for%20Testing%20Tools%20used%20in%20Digital%20and%20Multimedia%20Forensics.pdf

**CONFIRMED — SWGDE on tool-output misinterpretation, relevant to labelling derived assertions:**
> "Misinterpretation: The results have been incorrectly understood. Misunderstandings of what certain information means can result from a lack of understanding of the underlying data or **from ambiguities in the way digital and multimedia evidence forensic tools present information.**"
> — SWGDE 18-11-20 Establishing Confidence in DME, https://www.swgde.org/wp-content/uploads/2023/11/2018-11-20-SWGDE-Establishing-Confidence-in-DME.pdf
This is a standards-body argument for ForensiX visually/structurally distinguishing tool inference from raw record.

### 2.3 ISO/IEC 27037 and 27042 — PAYWALLED, content not guessed

**CONFIRMED (scope abstracts only, from the official ISO catalogue pages, HTTP 200):**
> 27042: "provides guidance on the analysis and interpretation of digital evidence in a manner which addresses issues of continuity, validity, reproducibility, and repeatability. It encapsulates best practice for selection, design, and implementation of analytical processes and **recording sufficient information to allow such processes to be subjected to independent scrutiny when required.**"
> — https://www.iso.org/standard/44406.html
> 27037: "provides guidelines for specific activities in the handling of digital evidence, which are identification, collection, acquisition and preservation of potential digital evidence..." — https://www.iso.org/standard/44381.html

**CONFIRMED (27037 §6.1 body text, but via an unofficial mirror — treat as indicative, verify against a licensed copy before relying on it):**
> "6.1 Chain of custody — In any investigation, the DEFR should be able to account for all the acquired data and devices ... The chain of custody record is a document identifying the chronology of the movement and handling of the potential digital evidence."
> — https://files.infocentre.io/files/docs_clients/3646_2007729925_1727780_ISO_IEC_27037.PDF (unofficial copy)

**STILL-UNKNOWN — whether 27037 or 27042 anywhere mandate an append-only or tamper-evident tool audit log.** Both are paywalled; the free abstracts say "recording sufficient information ... for independent scrutiny" and nothing about immutability. **Do not assert either way.** The 27042 iTeh sample PDF I fetched yielded only 138 chars of extractable text.

### 2.4 ASTM E2916 — PAYWALLED

**CONFIRMED it exists, is a *terminology* standard, and is on the OSAC Registry:**
> "ANSI/ASTM E2916-19e2 Standard Terminology for Digital and Multimedia Evidence Examination" — https://www.nist.gov/osac/standards-library/ansiastm-e2916-19e2 ; store page: https://store.astm.org/e2916-19e02.html ("3.1 This terminology includes general and specific terms...").
> Note the NIST OSAC library page shows an archive/replacement date of **05/05/2026** for E2916-19e2 — verify current registry status before citing.

**STILL-UNKNOWN — E2916's definitions of "bookmark", "note", "annotation", "audit trail".** Paywalled; not read. Since it is a *terminology* standard, it is the most likely single source of authoritative vocabulary for ForensiX's annotation naming — worth the purchase if vocabulary choice matters. Also note SWGDE 18-Q-002 cites **ASTM E2763 Standard Practice for Computer Forensics** as a reference; also paywalled and unread.

### 2.5 ENFSI

**CONFIRMED it exists and is free:** ENFSI "Best Practice Manual for the Forensic Examination of Digital Technology" — https://enfsi.eu/wp-content/uploads/2016/09/1._forensic_examination_of_digital_technology_0.pdf (HTTP 200, but my fetcher extracted only 167 chars of text — the PDF did not parse). Search-index excerpt confirms it contains §13 "PRESENTATION OF EVIDENCE" with 13.2 Staged Reports, 13.3 Investigative Reports and Opinion, 13.4 Technical Reporting and Evaluative Opinion.
**CONFIRMED (via secondary peer-reviewed source quoting ENFSI):**
> ENFSI defines technical reporting as "the 'factual' reporting of a test outcome based solely on the technical competence of the individual. **No inferences/explanations (opinion) are drawn from the test results (observations)**"
> — quoted in https://pmc.ncbi.nlm.nih.gov/articles/PMC9804552/
This is a clean, citable framing for ForensiX's split: **observation (tool-derived) vs opinion (examiner annotation)** is an established ENFSI distinction.
**STILL-UNKNOWN — ENFSI's specific text on audit trails / tool logging.** PDF did not extract; not read directly.

### 2.6 NIST CFTT / NISTIR

**CONFIRMED — CFTT is a *functional black-box testing* programme, not a tool-design/logging standard:**
> "The testing methodology developed by NIST is functionality driven. The activities of forensic investigations are separated into discrete functions or categories, such as hard disk write protection, disk imaging, string searching..."
> — https://www.nist.gov/itl/csd/secure-systems-and-applications/computer-forensics-tool-testing-program-cftt/cftt-general-0
> "The goal of the Computer Forensic Tool Testing (CFTT) project at NIST is to establish a methodology for testing computer forensic software tools by development of general tool specifications, test procedures, test criteria, test sets, and test hardware."
> — https://www.nist.gov/itl/csd/secure-systems-and-applications/computer-forensics-tool-testing-program-cftt

**STILL-UNKNOWN — whether any CFTT tool specification contains a logging/audit assertion.** I did not enumerate the assertion lists in the Digital Data Acquisition Tool Test Assertions and Test Plan (https://www.nist.gov/system/files/documents/2017/05/09/da-atp-pc-01.pdf) — that document also targets *acquisition* tools, not browser-artifact analysis tools, so its assertions are likely out of scope for ForensiX anyway. **There is no CFTT category for browser/Chrome-profile artifact parsing in the list I saw.**

### 2.7 Court-facing (FRE 702 / Daubert)

**CONFIRMED — FRE 702's text and committee notes contain no audit-log requirement.** A full-text search of the Cornell LII page for "audit" returned **no matches**; the operative reliability language is:
> "The amendment requires that the testimony must be the product of reliable principles and methods that are reliably applied to the facts of the case."
> "The trial court's gatekeeping function requires more than simply 'taking the expert's word for it.'"
> — https://www.law.cornell.edu/rules/fre/rule_702 (HTTP 200)
Interpretation limited to what is on the page: Rule 702 pressures *demonstrable, explainable method application*, which favours a durable record of what the tool did and what the examiner concluded — but the rule imposes **no** log-format, append-only, or hashing requirement. The 2023 amendment (effective 2023-12-01) shifted burden/standard language; see https://judicature.duke.edu/wp-content/uploads/sites/3/2024/12/2023AmendmentsCapra_Vol108No2.pdf (not read in depth).

**CONFIRMED — SWGDE testimony guidance sets the practical bar:**
> "Be prepared to explain the general functions performed by the tool rather than the programming of the tool. In other words, the examiner should be able to say what the tool does rather than how it works."
> — https://www.swgde.org/wp-content/uploads/2023/11/2022-09-22-SWGDE-Introduction-to-Testimony-in-Digital-and-Multimedia-Forensics-22-Q-001-1.1.pdf

### 2.8 What the tools actually log

**Velociraptor — CONFIRMED, the most explicit and best-documented audit model of the set.**
> "Velociraptor records auditable actions in two ways: 1. The Audit log is written to the audit directory 2. The Audit event is written to the `Server.Audit.Logs` event artifact."
> "**The audit event is divided into fixed fields (`ServerTime`, `operation` and `principal`) and a variable column `details` with a per event data.**"
> "You can forward server event logs to a remote syslog server by setting the value in the Logging.remote_syslog_server setting in the config. **We recommend this be done to archive audit logs.**"
> — https://www.velociraptor-docs.org/docs/deployment/security/ (HTTP 200)
> Artifact description: "Collects server audit events for significant user actions such as starting a new collection, creating a new hunt, updating an artifact definition etc." — https://docs.velociraptor.app/artifact_references/pages/server.audit.logs/ (direct fetch failed extraction; text obtained via https://docs.velociraptor.app/docs/artifacts/event_queues/ which repeats it verbatim)

Three things to note for ForensiX:
- Schema is **3 fixed fields + 1 open `details` blob**: `ServerTime`, `principal`, `operation`, `details`. That is a proven-minimal audit schema.
- Granularity is **significant write/state-changing actions** ("starting a new collection, creating a new hunt, updating an artifact definition"). **Reads/searches are not listed as audited.**
- **Tamper-evidence: STILL-UNKNOWN / apparently absent.** The documented mitigation is *off-box replication to remote syslog* — a compensating control, explicitly framed as "to archive audit logs." No hash chain is documented.

**X-Ways — CONFIRMED, the closest thing to an examiner-action audit log in commercial DF:**
> "When enabled in the case and the evidence properties window, WinHex obstinately logs all activities performed when the case is open. **That allows you to easily track, reproduce, and document the steps you have followed to reach a certain result, for your own information and for the court room.** The following is recorded: when you a select a menu item, the command title (or at least an ID), and the name of the active edit window, if not an evidence object, preceded by the keyword 'Menu'..."
> — https://documentation.help/WinHex-X-Ways/topic74.htm (**direct fetch HTTP 403 / Cloudflare**; text from search index — verify against the vendor manual before quoting in a report)
> Vendor whitepaper: "**Automated activity logging (audit logs)** — Logging of all activity is enabled by default. This can be helpful when backtracking your steps..." — https://x-ways.net/forensics/X-Ways_Forensics_White_Paper.pdf
> Vendor product page confirms the feature bullet "Automated activity logging (audit logs)" — https://www.x-ways.com/forensics/
> Case management page: "automated log and report file generation" — https://documentation.help/WinHex-X-Ways/topic73.htm
**Granularity is UI-action level, including navigation (menu selections)** — so X-Ways *does* capture something closer to reads than Velociraptor does. **Tamper-evidence: STILL-UNKNOWN** (nothing in what I retrieved describes signing or chaining the case log).

**Autopsy — CONFIRMED only that case-scoped logs exist; contents/fields NOT documented in current docs.**
> "There are two sets of logs - the system logs and the case logs. ... Case logs: (case folder)\Logs / System logs: C:\Users\(user name)\AppData\Roaming\autopsy"
> — https://sleuthkit.org/autopsy/docs/user-docs/4.19.3/troubleshooting_page.html
> The current 4.22 page "Viewing Case Logs and Output" (fetched raw, HTTP 200) contains **only** UI navigation instructions — no field list, no statement of what is recorded: "There are several shortcuts for getting to the case and log folders." — http://sleuthkit.org/autopsy/docs/user-docs/4.22.0/logs_and_output_page.html
> Ingest provenance *is* recorded, per the changelog: "Ingest history (start time, end time, status, **which versions of which ingest modules were run**)." — https://github.com/sleuthkit/autopsy/blob/develop/NEWS.txt
> Historical note (**Autopsy 1.x / Forensic Browser, NOT current Autopsy 4.x — do not conflate**): "The case.log file is the audit log for the case" — https://sleuthkit.org/informer/sleuthkit-informer-2.html (March 2003).
**Autopsy audit-log tamper-evidence: STILL-UNKNOWN / no evidence of any.** Autopsy logs are plain files in the case folder, writable by the examiner.

**Timesketch — STILL-UNKNOWN, and this is a real gap.** I found **no** Timesketch documentation page describing a user-action audit log. What exists is operational observability, not forensic audit: OpenTelemetry tracing ("Distributed Tracing: Track a single request from an external tool (like dftimewolf) through the API and into background analyzers", https://timesketch.org/guides/admin/OpenTelemetry/) and a performance profiler (https://timesketch.org/guides/admin/performance_monitoring/). Analyzer runs get a status/"audit note" via the admin CLI (https://timesketch.org/guides/admin/admin-cli/). SQL models carry `user_id` on Story/Sketch and `StatusMixin`, giving *authorship* but not an action log. **Treat "Timesketch has an audit trail" as unconfirmed.**

**Hindsight — CONFIRMED: a single append-mode run log, nothing more.** `-l or --log | Location Hindsight should log to (will append if exists)` — https://github.com/obsidianforensics/hindsight. Append-on-open, not append-only-enforced, not tamper-evident.

### 2.9 Direct answers to the Q2 questions

- **Is append-only / hash-chained audit logging *required* by a DF standard?** — **No source found saying yes. STILL-UNKNOWN for the paywalled standards (ISO 27037/27042, ASTM E2916/E2763); CONFIRMED absent from SWGDE 18-Q-002, FRE 702 text and committee notes, and CFTT programme descriptions.**
- **Is it *recommended*?** — **Not found in DF sources.** The nearest confirmed adjacent requirements are (a) reproducibility/technical-record sufficiency (SWGDE 18-Q-002 fn.1 citing AR3125 7.5.1.3), (b) contemporaneous note-taking (SWGDE 12-F-006), (c) off-box archiving of audit logs (Velociraptor's own recommendation).
- **Is it conventional?** — **Not even that, among the tools examined.** Zero of Autopsy, Timesketch, Velociraptor, X-Ways, Hindsight document any tamper-evident/hash-chained log. Hash-chained audit logging in ForensiX would be **above** current practice, not table stakes. Defensible as a design choice; **must not be described as standards-mandated.**
- **Are reads logged?** — X-Ways: yes, at menu-selection granularity (CONFIRMED-with-caveat, 403 source). Velociraptor: not in the documented `Server.Audit.Logs` action list (state-changing actions only). Autopsy/Timesketch/Hindsight: **STILL-UNKNOWN / no evidence.**

---

## Source table

| # | Source | URL | HTTP / retrieval | Use |
|---|---|---|---|---|
| 1 | Autopsy User Docs 4.23 — Tagging and Commenting | http://sleuthkit.org/autopsy/docs/user-docs/4.23.0/tagging_page.html | 200, full text | **Primary** — tag/comment vocabulary, Tag File vs Tag Result, user attribution |
| 2 | Autopsy User Docs 4.23 — Interesting Files Identifier | https://sleuthkit.org/autopsy/docs/user-docs/4.23.0/interesting_files_identifier_page.html | 200, full text | **Primary** — tool-derived "Interesting Items" kept in Results tree |
| 3 | Autopsy API — TagsManager | https://sleuthkit.org/autopsy/docs/api-docs/4.16.0/classorg_1_1sleuthkit_1_1autopsy_1_1casemodule_1_1services_1_1_tags_manager.html | 200 (search index) | **Primary** — ContentTag vs BlackboardArtifactTag signatures |
| 4 | Autopsy API — CommentChangedEvent | https://www.sleuthkit.org/autopsy/docs/api-docs/4.19.3/classorg_1_1sleuthkit_1_1autopsy_1_1casemodule_1_1events_1_1_comment_changed_event.html | 200 (search index) | Central-repo comment keyed to content objectId |
| 5 | Autopsy User Docs 4.22 — Viewing Case Logs and Output | http://sleuthkit.org/autopsy/docs/user-docs/4.22.0/logs_and_output_page.html | 200, raw HTML read | **Negative evidence** — no log field documentation |
| 6 | Autopsy User Docs 4.19.3 — Troubleshooting | https://sleuthkit.org/autopsy/docs/user-docs/4.19.3/troubleshooting_page.html | 200 (search index) | Case logs vs system logs locations |
| 7 | Autopsy NEWS.txt | https://github.com/sleuthkit/autopsy/blob/develop/NEWS.txt | 200 (search index) | Ingest history incl. module versions |
| 8 | Sleuth Kit Informer #2 (2003) | https://sleuthkit.org/informer/sleuthkit-informer-2.html | 200 (search index) | Autopsy **1.x** case.log = "audit log" — legacy, do not conflate with 4.x |
| 9 | Hindsight README | https://github.com/obsidianforensics/hindsight | 200, full text | **Primary** — no annotation concept; `-l/--log` append |
| 10 | Timesketch — Basic concepts | https://timesketch.org/guides/user/basic-concepts/ | 200, full text | **Primary** — comment/star/tag/label semantics; analyzers write tags |
| 11 | Timesketch — models/sketch.py | https://github.com/google/timesketch/blob/master/timesketch/models/sketch.py | 200, full text | **Primary** — `Event(sketch_id, searchindex_id, document_id)`, `Story` model |
| 12 | Timesketch — CLI client | https://timesketch.org/guides/user/cli-client/ | 200 (search index) | `export-only-with-annotations` |
| 13 | Timesketch PR #3398 | https://github.com/google/timesketch/pull/3398 | 200 (search index) | Annotation = comment / star / user-defined label |
| 14 | Timesketch — OpenTelemetry / Performance / Admin CLI | https://timesketch.org/guides/admin/OpenTelemetry/ ; .../performance_monitoring/ ; .../admin-cli/ | 200 (search index) | **Negative evidence** — observability, not audit |
| 15 | Velociraptor — Security Configuration | https://www.velociraptor-docs.org/docs/deployment/security/ | 200, full text | **Primary** — Auditable Actions; ServerTime/operation/principal/details; syslog archiving |
| 16 | Velociraptor — Server.Audit.Logs artifact | https://docs.velociraptor.app/artifact_references/pages/server.audit.logs/ | 200 but **extraction failed**; text confirmed verbatim via https://docs.velociraptor.app/docs/artifacts/event_queues/ | Audit artifact description |
| 17 | Velociraptor — Notebooks | https://docs.velociraptor.app/docs/notebooks/ ; https://docs.velociraptor.app/docs/vql/notebooks/ | 200 (search index) | **Primary** — markdown cell vs VQL cell |
| 18 | X-Ways — Case Log | https://documentation.help/WinHex-X-Ways/topic74.htm | **403 Forbidden (Cloudflare)** on direct fetch; text via search index | Case log contents — **verify before citing** |
| 19 | X-Ways — Report Tables / Columns & Filters | https://documentation.help/WinHex-X-Ways/topic95.htm ; .../topic91.htm | 403 on direct fetch; text via search index | Report table = examiner marking, filterable column |
| 20 | X-Ways vendor whitepaper / product page | https://x-ways.net/forensics/X-Ways_Forensics_White_Paper.pdf ; https://www.x-ways.com/forensics/ | 200 (search index) | **Vendor primary** — "Automated activity logging (audit logs)" |
| 21 | X-Ways manual PDF | https://www.x-ways.com/winhex/manual.pdf | 200 but only 152 chars extracted | §5.5 Case Log / §5.7 Labels **unread** |
| 22 | SWGDE 18-Q-002 Report Writing | https://www.swgde.org/documents/published-complete-listing/18-q-002-swgde-requirements-for-report-writing-in-digital-and-multimedia-forensics/ | 200, full text | **Primary, key** — notes vs report; tool reports as appendix; AR3125 7.5.1.3 |
| 23 | SWGDE 12-F-006 Core Competencies | https://www.swgde.org/documents/published-complete-listing/12-f-006-core-competencies-for-digital-forensics/ | 200 | "contemporaneous notes" competency |
| 24 | SWGDE 19-F-003 Archiving | https://www.swgde.org/wp-content/uploads/2023/11/2020-09-17-SWGDE-Best-Practices-for-Archiving-Digital-and-Multimedia-Evidence_v1.0.pdf | 200 but only 201 chars extracted; §5.1.3 text via search index | Audit-trail *content* fields (who/what/when/where/why/how) |
| 25 | SWGDE 18-Q-001 Minimum Requirements for Testing Tools | https://www.nist.gov/system/files/documents/2023/08/11/SWGDE%2018-Q-001-1.0%20Minimum%20Requirements%20for%20Testing%20Tools%20used%20in%20Digital%20and%20Multimedia%20Forensics.pdf | 200 (search index) | §5.6 in-house developed tools must be independently tested |
| 26 | SWGDE Establishing Confidence in DME | https://www.swgde.org/wp-content/uploads/2023/11/2018-11-20-SWGDE-Establishing-Confidence-in-DME.pdf | 200 (search index) | Misinterpretation from ambiguous tool presentation |
| 27 | SWGDE Introduction to Testimony 22-Q-001 | https://www.swgde.org/wp-content/uploads/2023/11/2022-09-22-SWGDE-Introduction-to-Testimony-in-Digital-and-Multimedia-Forensics-22-Q-001-1.1.pdf | 200 (search index) | Court-facing expectations on explaining tools |
| 28 | ISO/IEC 27042:2015 catalogue | https://www.iso.org/standard/44406.html | 200 | Abstract only — **paywalled body** |
| 29 | ISO/IEC 27037:2012 catalogue | https://www.iso.org/standard/44381.html | 200 | Abstract only — **paywalled body** |
| 30 | ISO/IEC 27037 unofficial mirror | https://files.infocentre.io/files/docs_clients/3646_2007729925_1727780_ISO_IEC_27037.PDF | 200 (search index) | §6.1 chain of custody — **unofficial, verify** |
| 31 | ISO/IEC 27042 iTeh sample | https://cdn.standards.iteh.ai/samples/44406/c986892bfdca440fa33c5eda1e57e23a/ISO-IEC-27042-2015.pdf | 200 but only 138 chars extracted | Preview only — **unread** |
| 32 | NIST OSAC — ASTM E2916-19e2 | https://www.nist.gov/osac/standards-library/ansiastm-e2916-19e2 | 200 | Registry status; archive date 05/05/2026 |
| 33 | ASTM store — E2916 | https://store.astm.org/e2916-19e02.html | 200 | **Paywalled** — terminology definitions unread |
| 34 | ENFSI BPM Forensic Examination of Digital Technology | https://enfsi.eu/wp-content/uploads/2016/09/1._forensic_examination_of_digital_technology_0.pdf | 200 but only 167 chars extracted | **Effectively unread** — TOC via search index |
| 35 | Technical reporting in digital forensics (peer-reviewed) | https://pmc.ncbi.nlm.nih.gov/articles/PMC9804552/ | 200 (search index) | Quotes ENFSI "no inferences/explanations (opinion) are drawn from the test results (observations)" |
| 36 | NIST CFTT programme + methodology | https://www.nist.gov/itl/csd/secure-systems-and-applications/computer-forensics-tool-testing-program-cftt ; .../cftt-general-0 | 200 (search index) | CFTT = functional black-box testing |
| 37 | FRE 702 (Cornell LII) | https://www.law.cornell.edu/rules/fre/rule_702 | 200, full text | **Primary** — full-text search for "audit" = **no matches** |
| 38 | Duke Judicature — 2023 Amendment to FRE 702 (Capra) | https://judicature.duke.edu/wp-content/uploads/sites/3/2024/12/2023AmendmentsCapra_Vol108No2.pdf | 200 (search index) | Context only — **not read in depth** |
| 39 | OWASP APTS Auditability | https://owasp.org/APTS/standard/5_Auditability/Implementation_Guide.html | 200 (search index) | **Counter-example** — hash-chain requirement exists, but in a pentest standard, NOT forensics |

**Dropped:** miratag.com / konfirmity.com ISO explainers, LinkedIn post on ISO 17025 cl.7.11, forensicfocus commentary, NorESM/IBM/timberfs `case.log` false positives — all SEO/secondary/irrelevant. O'Reilly X-Ways Practitioner's Guide chapter retained only as corroboration, flagged as a commercial book, not vendor documentation.

---

## What I could NOT confirm (explicit list)

1. **Autopsy tag survival on re-ingest / data-source re-add.** Not documented in fetched pages. **STILL-UNKNOWN.**
2. **Timesketch annotation survival on re-import of the same timeline** (whether `document_id` is stable across uploads). Data model is `(sketch_id, searchindex_id, document_id)`; stability of `document_id` not documented. **STILL-UNKNOWN.**
3. **X-Ways report-table survival across volume-snapshot refresh.** Vendor manual PDF unreadable via my fetcher. **STILL-UNKNOWN.**
4. **EnCase bookmark data model / re-processing behaviour.** No accessible primary OpenText doc found. **STILL-UNKNOWN.**
5. **ISO/IEC 27037 & 27042 normative text on audit logs / tamper-evidence.** Paywalled. Only abstracts read. **Deliberately not guessed.**
6. **ASTM E2916 (and E2763) definitions** of bookmark/note/annotation/audit trail. Paywalled. **Not read.**
7. **ENFSI BPM text on audit trails and tool logging.** PDF did not extract. **Not read.**
8. **Whether any CFTT tool specification contains a logging/audit assertion.** Assertion lists not enumerated; also likely out of scope (no browser-artifact CFTT category found). **STILL-UNKNOWN.**
9. **Timesketch user-action audit log.** No documentation found that one exists. **STILL-UNKNOWN — do not assume it exists.**
10. **Any tamper-evidence (signing/hash-chaining) in Autopsy, Timesketch, Velociraptor, X-Ways, or Hindsight logs.** No evidence found for any of them. **STILL-UNKNOWN, presumed absent.**
11. **X-Ways Case Log verbatim text** — best source returned HTTP 403; quote came from a search index and should be re-verified against the vendor manual before appearing in any ForensiX document.

### Suggested next steps
- Buy/borrow **ASTM E2916** (terminology) before finalising ForensiX's annotation vocabulary — it is the only body that authoritatively defines these words, and SWGDE cites it.
- Obtain a licensed **ISO/IEC 27042** copy to settle the "recording sufficient information" question definitively.
- Empirically test Autopsy tag behaviour on re-ingest and Timesketch `document_id` stability on re-upload in a throwaway VM — both are cheap experiments that answer gaps 1 and 2 better than any doc would.
- Re-fetch the X-Ways manual PDF with a working PDF text extractor to read §5.5 (Case Log) and §5.7 (Labels).

### Design conclusions ForensiX can safely defend
- **Separate storage for examiner assertions and tool-derived assertions is established practice** (Autopsy: two tag tables + separate tree; Velociraptor: markdown vs VQL cells), and Timesketch's shared `tag` field is a documented example of the ambiguity SWGDE warns about.
- **Binding annotations to a stable row/artifact id is universal**; every tool that annotates does so against an id (Autopsy obj id / artifact id; Timesketch `document_id`; X-Ways object in the volume snapshot).
- **Append-only / hash-chained audit logging is a legitimate but supra-standard choice.** Justify it on reproducibility and independent-review grounds (SWGDE 18-Q-002 fn.1 / AR3125 7.5.1.3, ISO 27042 abstract), **never** as a standards mandate.
- **A minimal defensible audit record schema already exists in the wild:** Velociraptor's `ServerTime | principal | operation | details`, and SWGDE's archiving field list who / what / when / where / why / how.
