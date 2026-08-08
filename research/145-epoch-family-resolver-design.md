# Epoch Family resolver design — #145

**Answers [#145](https://github.com/ChmaraX/forensix/issues/145), which folded in
[#150](https://github.com/ChmaraX/forensix/issues/150) (the `synthetic`/quintuple decision) by
edit on 2026-08-08. Builds on the facts in
[`research/143-timestamp-epoch-version-matrix.md`](143-timestamp-epoch-version-matrix.md) and the
data table [`research/143-timestamp-epoch-table.yaml`](143-timestamp-epoch-table.yaml) — neither is
redone here.**

**Source-access status: PARTIAL LIVE.** New primary-source fetches were made against Chromium
source over gitiles `?format=TEXT` (§B) and against the `hindsight` tool's actual source over
`raw.githubusercontent.com` and the GitHub REST API (§B). Everything else is design reasoning over
already-landed research (`#143`, `CONTEXT.md`) — marked inline as "no new fetch". Nothing in this
file was guessed and presented as sourced; where a fetch failed or a question has no primary
source, it is in §7 (verification queue), not asserted as fact.

**New ref read:** `2b60aa19f6b8b148da902764590880dad9f25211` (chromium/src `refs/heads/main`, at
fetch time — one autoroll or more ahead of `#143`'s `cb211f6`/`ba3c200`; used only to confirm the
process-singleton mechanism and that `FixVersionIfNeeded` still exists at its cited location, not
to re-derive `#143`'s epoch claims).

---

## 0. What this ticket had to settle (recap)

Six questions, listed in the issue and repeated in its two comments (the second folding in #150):

- **A.** Resolution order.
- **B.** How originating OS enters the system.
- **C.** Field State when OS is unknown and the version is ambiguous.
- **D.** Triple vs quintuple, and the exact `CONTEXT.md` wording this forces.
- **E.** Where the per-column table lives (code vs data).
- **F.** Whether a heuristically-resolved column can ever be a `Finding`.

---

## 1. Summary

**A — Resolution order.** The issue's proposed order — verified column set → schema version →
originating OS → magnitude test → `unavailable` — is **confirmed, with one refinement**: "schema
version" must be understood as *`FixVersionIfNeeded`-corrected* version, not the raw
`meta.version` on disk, because the correction changes which of the later steps even apply
(§4.1's Login Data `date_created` example moves from "needs OS" to "doesn't" once the version is
sniffed correctly). The order is a strict cascade — each step is tried only if the previous one
did not produce a `verified` result — and the magnitude test is demoted from "resolver" to
"narrower that can feed a `Candidate`", per the issue's own `offer_data.expiry` finding.

**B — How OS enters the system.** **Operator-declared, exactly like Declared Timezone, is the
correct default — not because a derived signal is unavailable, but because the derived signal that
exists (`SingletonLock`) is asymmetric and its absence is not evidence of anything.** Live source
reading (§4.2) confirms Chromium's process-singleton mechanism differs completely by platform:
POSIX (macOS/Linux) creates `SingletonLock` as a **symlink** whose target string encodes
`hostname-pid`; Windows creates a plain **file** named `lockfile`, opened with
`FILE_FLAG_DELETE_ON_CLOSE`, holding no path-embedded metadata and belonging to a different file
(`chrome/browser/process_singleton_win.cc`, not `..._posix.cc`) under a different constant
(`kLockfile = "lockfile"`, not `chrome::kSingletonLockFilename = "SingletonLock"`). So *presence of
a `SingletonLock` symlink* is directly diagnostic of non-Windows origin — but its *absence* is not
diagnostic of Windows, because Liveness Evidence is destroyed by a naive copy (`CONTEXT.md`) and
the Windows `lockfile` is deleted-on-close by design, so a cleanly-shut-down Windows Chrome leaves
no lock artifact either. The signal is therefore a one-directional **Candidate discriminator**, not
a Finding-grade fact, and precedent for treating a derived clue as `Candidate`-only already exists
in `143-timestamp-epoch-table.yaml`'s `discriminators[]`. `hindsight` — the only comparable
open-source tool checked — has **no OS-origin handling at all**; it resolves epoch purely by
numeric magnitude window and never asks which OS wrote the value (§4.2.4). That is independent
confirmation that this is an unsolved problem in the field, not one ForensiX is uniquely failing
to solve. Recommendation: **operator-declared is primary** (parallel to Declared Timezone, always
labelled as declared), **`SingletonLock` presence is an optional corroborating Candidate signal**
usable only to *support* a declared OS or to flag a conflict, never to assert OS on its own.

**C — Field State under OS ambiguity.** `unavailable`, with the magnitude test determining whether
a `Candidate` is *also* emitted alongside it. For History `meta.version <= 16`
(`urls.last_visit_time`, `visits.visit_time`, `segment_usage.time_slot`), the magnitude test is
**decisive** — Unix-µs and 1601-µs are 2 orders of magnitude apart for any date in the schema's
2008–2013 era and cannot overlap (`#143` part-1 §1.3(a)) — so the Field State is `unavailable` for
the *epoch-resolved value* while a `Candidate` (ranked, with its magnitude-derived confidence) is
emitted alongside it. For `offer_data.expiry`, the magnitude test is **defeated** (13-digit
1601-ms and 13-digit Unix-ms overlap exactly, 369 years apart, both dates plausible) — no
discriminator exists at all, so the Field State is `unavailable` with **no accompanying
Candidate**, because a Candidate requires a ranking mechanism and none exists here. This is exactly
`143-timestamp-epoch-table.yaml`'s existing `ambiguity.discriminators[].emit_as: candidate` design;
this ticket adds the rule for when a discriminator is absent rather than merely inferred.

**D — Triple vs quintuple.** **Recommend (c)**, matching the issue author's stated lean: keep the
three-state `Field State` trichotomy unchanged (`value`/`absent`/`unavailable`), add a `synthetic`
flag beside `value` (not a fourth Field State, because a synthetic timestamp genuinely *has* a
value — option (a) would misrepresent that), and extend the stored triple (raw value, epoch
family, UTC instant) to a **quintuple**: raw value, epoch family, UTC instant, **resolution
provenance** (which rule in the §2 cascade fired, and whether a heuristic was used), **synthetic
flag**. §5 gives the reasoning against all four concrete synthetic cases now on record — the three
in #150 plus a fourth found in `143-timestamp-epoch-table.yaml` (`Bookmarks.date_added` /
`.date_modified` backfilled to `base::Time::Now()` when the JSON key is missing at parse time) —
and drafts the exact `CONTEXT.md` wording for `Epoch Family`, `Declared Timezone`, and `Finding`,
as a proposal only. `CONTEXT.md` itself is not edited by this file.

**E — Where the table lives.** Already answered by Lane B and not repeated here beyond one
pointer: `research/143-timestamp-epoch-table.yaml` plus its design notes at
`research/_raw/143-epoch-table-NOTES.md` conclude **data for the facts** (family, version range,
platform, sentinel, synthetic, negative, provenance — 99 rows, machine-checked) **and code for the
resolver procedure** (the column-sniffing ladder, the magnitude fallback, the table-generation
dispatch) that *loads* the table rather than restating it. This design's §2 resolution cascade is
exactly that procedure, and it consumes the YAML's `epoch[]`, `ambiguity`, `sentinels[]`,
`synthetic[]` fields directly — nothing new needs to be added to the schema for A–D to be
implementable.

**F — Can a heuristically-resolved column ever be a `Finding`?** No, by direct application of the
existing `CONTEXT.md` definitions (`Candidate` — "never presented as a finding"; `Finding` — "only
a `value` with provenance"). `offer_data.expiry`-class columns cannot even reach `Candidate` status
via magnitude (the test is defeated, so it falls straight to `unavailable`, no ranking exists to
call a Candidate). History-`v<=16`-class columns reach `Candidate` (magnitude is decisive), but
still never a `Finding` from the heuristic alone — **unless the OS is independently confirmed by
an operator declaration**, at which point the column is no longer resolved by a heuristic at all:
it becomes a verified (column identity, version, **declared** OS) combination, which is exactly
the resolution class the §2 cascade's third step (originating OS, when supplied) already treats as
non-heuristic and eligible for `Finding` status, carrying `resolution_provenance: operator_declared`
rather than `resolution_provenance: magnitude_heuristic`.

---

## 2. A — Resolution order

### 2.1 The proposed cascade, evaluated

> verified column set → schema version → originating OS (when required) → magnitude test →
> `unavailable`

Checked against every hazard class `#143` documented:

| Step | What it resolves | Hazard it must survive | Confirmed against |
|---|---|---|---|
| 1. Verified column set | Which artifact/table/column this is | The **name collision** hazard — `use_date` and `date_created` each mean two epochs depending on table (`#143` §6.2, §6.4) | `Web Data` — the resolver must key on `(artifact, table, column)`, never on column name alone. Already the YAML's primary key. |
| 2. Schema version (**corrected**, see 2.2) | The version-bounded rule, once the recorded `meta.version` is trusted | `FixVersionIfNeeded` column-sniffing (`login_database.cc:916-950`, confirmed still present at `2b60aa19f` — see §4.1) | Login Data `date_created`: a file recording `meta.version <= 8` but possessing `date_last_used` is really v25 and 1601-µs, not Unix-s. |
| 3. Originating OS (when required) | Platform-conditional migrations | History v16→17, Cookies v3→v4 — version bumps everywhere, data rewritten only off-Windows (`#143` §2.2) | Only reachable when step 2 lands the column in a version range flagged `ambiguity.state: requires_os_input` in the YAML (6 rows). |
| 4. Magnitude test | A last-resort narrowing, never a resolution | Works for History `v<=16` (2 orders of magnitude apart, `#143` part-1 §1.3(a)); **fails** for `offer_data.expiry` (13 digits both ways, `#143` §6.3) | Produces a `Candidate`, never a `value`. See §3. |
| 5. `unavailable` | Nothing above fired | — | Terminal state, with a `reason` naming which step failed to resolve (`ambiguity.state` in the YAML already enumerates the reasons: `requires_os_input`, `version_field_untrusted`, `unresolved_source_deleted`, `not_examined`). |

**Confirmed as the correct order**, with 2.2 as the one necessary refinement.

### 2.2 Refinement — step 2 must be the *corrected* version, not the raw one

The issue text says "schema version" as if it is a single lookup. It is not: `#143` §2.1
establishes that `meta.version` **on disk can itself be wrong**, and Chrome's own repair path
(`FixVersionIfNeeded`) is a *column-sniffing procedure*, not a version read. Re-confirmed live at
`2b60aa19f` (current `refs/heads/main`, one or more autorolls past `#143`'s `cb211f6`):

```
$ curl -s '.../components/password_manager/core/browser/password_store/login_database.cc?format=TEXT'
916: bool FixVersionIfNeeded(sql::Database* db, int* current_version) {
...
944:   if (*current_version < 25) {
945:     if (db->DoesColumnExist("logins", "date_last_used")) {
946:       *current_version = 25;
947:     }
948:   }
```

(source: `components/password_manager/core/browser/password_store/login_database.cc:916-950` @
`2b60aa19f`; `#143` cited the same function at `login_database.cc:914-950` @ `cb211f6` — the
function persists across the autoroll gap, one line earlier, confirming the mechanism is not a
transient artifact of the ref `#143` happened to read.)

**Consequence for the cascade:** "step 2, schema version" must itself be a two-part sub-procedure:
(2a) run the artifact's column-sniffing corrections if any are documented for it (currently only
Login Data has one, per `#143`'s coverage — the YAML's `artifacts.LoginData.version_field_trustworthy:
false` flag, confirmed present in `143-timestamp-epoch-table.yaml`), (2b) *then* look up the
version-range rule against the corrected version. Skipping (2a) is precisely the bug `#143`
diagnoses: "a parser trusting `meta.version` verbatim is wrong by 369 years on precisely the files
where the epoch question is live." No new fact is being asserted here beyond what `#143` already
found — this section states it as a resolver **procedure step**, which is what was missing.

### 2.3 Why the order can't be reshuffled

- OS-before-version would waste an operator input (or a corroborating signal) on the ~93% of rows
  that have no `requires_os_input` ambiguity at all (6 of 99 rows in the YAML).
- Magnitude-before-OS would silently accept a `Candidate` where a `Finding`-grade resolution
  (operator-declared OS) was available, understating confidence for no reason.
- Column-identity has to be first structurally — every other step operates on a `(artifact, table,
  column)` key, and getting that wrong (e.g. via a name-based lookup) invalidates every later step,
  per the `use_date` collision.

---

## 3. B — How the originating OS enters the system

### 3.1 The question restated

`#143` established the *fact*: no Chrome artifact records the OS that wrote a History `v<=16` or
Cookies `v<=3` file. This ticket has to decide the *mechanism* by which ForensiX still gets an
answer. Three candidate mechanisms were investigated, one of them via new primary-source reading.

### 3.2 Live source reading — Chrome's process-singleton lock, by platform

Fetched `2b60aa19f6b8b148da902764590880dad9f25211` (chromium/src `refs/heads/main` at fetch time):

**POSIX (macOS/Linux)** — `chrome/browser/process_singleton_posix.cc` (200, 1180 lines):

```
21: // We also have a lock file, which is a symlink to a non-existent destination.
22: // The destination is a string containing the hostname and process id of
23: // chrome's browser process, eg. "SingletonLock -> example.com-9156".
...
338: bool SymlinkPath(const base::FilePath& target, const base::FilePath& path) {
339:   if (!base::CreateSymbolicLink(target, path)) {
...
1013: // The symlink lock is pointed to the hostname and process id, so other
1014: // processes can find it out.
1015: base::FilePath symlink_content(
1016:     base::StringPrintf("%s%c%u", net::GetHostName().c_str(),
1017:                         kProcessSingletonLockDelimiter, current_pid_));
...
1021: if (!SymlinkPath(symlink_content, lock_path_)) {
```

**Windows** — `chrome/browser/process_singleton_win.cc` (200, 509 lines), a **different
mechanism entirely**:

```
48:  const char kLockfile[] = "lockfile";
...
244:  lock_file_handle = ::CreateFile(
245:      lock_file_path.value().c_str(), GENERIC_WRITE, FILE_SHARE_READ,
246:      nullptr, CREATE_ALWAYS,
247:      FILE_ATTRIBUTE_NORMAL | FILE_FLAG_DELETE_ON_CLOSE, nullptr);
...
456:  base::win::ScopedHandle only_me(::CreateMutex(NULL, FALSE, kMutexName));
```

Windows never calls `SymlinkPath`; it creates a plain file at
`user_data_dir.AppendASCII(kLockfile)` (a literal file named `"lockfile"`, lowercase, no relation
to `chrome::kSingletonLockFilename`) via Win32 `CreateFile` with `FILE_FLAG_DELETE_ON_CLOSE`, and
separately serialises startup via a named kernel `Mutex` (`Local\ChromeProcessSingletonStartup!`)
that has **no on-disk representation at all**. Confirmed the filename constant Chrome actually
names `SingletonLock` is POSIX/Mac-only in practice — `chrome/common/chrome_constants.h:119-120` @
`2b60aa19f` declares `kSingletonLockFilename[] = FILE_PATH_LITERAL("SingletonLock")`, and only
`process_singleton_posix.cc` (used for `IS_POSIX`, i.e. macOS and Linux — Mac carries extra
`#if BUILDFLAG(IS_MAC)` branches in the same file, e.g. `ReplaceOldSingletonLock` at line 480, but
is still the POSIX file, not a third implementation) references `lock_path_ =
user_data_dir.Append(chrome::kSingletonLockFilename)` (`process_singleton_posix.cc:766`). Windows'
`process_singleton_win.cc` never references `kSingletonLockFilename` — grepped, zero hits.

**Interpretation, stated carefully:**

- A `SingletonLock` file present **and it is a symlink** whose target parses as
  `hostname` + delimiter + `pid` (confirmed pattern at `process_singleton_posix.cc:1015-1017`, and
  independently confirmed present in a real capture — `research/117-chrome151-characterization.md`
  line 55: *"`SingletonLock` is a symlink whose target encodes `hostname-pid`"*, `#143`'s Chrome 151
  macOS fixture) is **positive evidence of macOS/Linux origin**. No Windows code path produces
  this file under this name with this shape.
- **Its absence proves nothing.** Three explanations are consistent with absence, and the resolver
  cannot distinguish them from file state alone: (1) the origin OS is Windows (which never creates
  this file), (2) the origin OS is macOS/Linux but Chrome shut down cleanly and removed the lock on
  exit (the POSIX code documents deleting it on shutdown, part 1 header comment line 24: *"When
  the first copy of chrome exits it will delete the lock file"*), or (3) the acquisition process
  did not preserve the symlink (`CONTEXT.md`'s own `Liveness Evidence` definition: *"Destroyed by a
  naive copy"* — a copy tool that dereferences symlinks turns it into a regular file or drops it).
  This matches `research/117-chrome151-characterization.md`'s finding 6 verbatim: `SingletonLock`
  "does not survive a naive file copy that dereferences symlinks."
- **The Windows `lockfile` is not a usable substitute signal either.** It carries no
  hostname/pid payload (it's an empty file whose only content is its existence while Chrome runs)
  and is `FILE_FLAG_DELETE_ON_CLOSE`, so on a cleanly-shut-down Windows profile it will not exist
  on disk at all — a Working Copy of a shut-down Windows profile and a Working Copy of a
  shut-down/naively-copied macOS profile are **indistinguishable by lock-file presence**, both
  showing "no lock file."

This is a **one-directional discriminator**: presence-of-POSIX-symlink implies non-Windows;
absence implies nothing. It belongs exactly where `143-timestamp-epoch-table.yaml`'s existing
`ambiguity.discriminators[]` already puts the magnitude and `downloads.full_path` signals — tagged
`emit_as: candidate`, corroborating only, never resolving alone.

### 3.3 The Manifest as a channel — checked, and it is not a substitute

`research/121-acquisition-practice.md` row 4 (the `ACQUISITION_BUNDLE` source kind) proposes a
`manifest.json` carrying "per-file SHA-256, size, MACB timestamps, original absolute path,
acquisition method, operator, **host**, tool+version, UTC times" (no new fetch — this is existing
research, quoted verbatim). Two things matter here that the issue conflates:

1. **This `host` field is the acquiring/collection host, not necessarily the Chrome-writing
   host.** An investigator can image a Windows laptop from a macOS analysis workstation; the
   Manifest's `host` in the acquisition-practice proposal describes the *collection* environment.
   Nothing in `#121`'s brief proposes capturing the *originating* Chrome host as a distinct field,
   and no primary Chromium source records it either — so the Manifest, **as currently scoped**,
   does not close this gap. It could be extended to (an operator-supplied `origin_os` field is
   exactly the "operator-declared" mechanism recommended below, and the Manifest is the natural
   place to put it structurally), but that is a scope decision for whoever owns the Manifest
   schema (`#125`'s successor / the acquisition tooling), not something this ticket can assert as
   already true.
2. **Path syntax is available, but redundant with, and weaker than, `downloads.full_path`.**
   `#121` §"macOS specifics"/"exact per-OS paths" documents that the acquisition tool records
   `original absolute path` per file. If that path is the *User Data Dir* path itself (e.g.
   `/Users/<name>/Library/Application Support/Google/Chrome/` vs
   `C:\Users\<name>\AppData\Local\Google\Chrome\User Data\`), it is a legitimate corroborating
   signal of collection-host OS, by the same logic `#143` part-1 §1.3(b) already applies to
   `downloads.full_path` — but it answers "what OS was this copied *from*," which for a live
   collection equals the origin OS, but for an `IMAGE_CONTAINER`/forensic-image source (one of
   `CONTEXT.md`'s five `Source` kinds) is exactly the origin OS by definition, since the image
   *is* the original disk. So Manifest path syntax is a real, if narrower, restatement of the
   `downloads.full_path` discriminator, not a new independent one.

### 3.4 Precedent — how `hindsight` handles this today

Fetched `https://raw.githubusercontent.com/RyanDFIR/hindsight/main/pyhindsight/utils.py` (200; the
GitHub API confirms `obsidianforensics/hindsight` now redirects to `RyanDFIR/hindsight` — repo
renamed/transferred, same codebase, checked live via `api.github.com/repos/obsidianforensics/hindsight`
→ HTTP 301 → `RyanDFIR/hindsight`). Its `to_datetime()` function (`pyhindsight/utils.py:99-176`) is
a **pure magnitude-window classifier** with seven bands (Webkit-µs ≥18-digit overflow guard,
Webkit-µs 17-digit, Unix-µs 16-digit, Unix-ms 13-digit, Webkit-ms 14-digit, Webkit-s 11-digit,
Unix-s fallback), each a hardcoded numeric range with a comment naming the plausible calendar-year
window (e.g. `elif 2500000000000 > timestamp > 1280000000000: # 2049 > ts > 2010`). **Grepped the
full file for `platform`, `windows`, `mac`, `linux`, `sys.platform`, `origin.*os` — zero matches.**
`hindsight` does not attempt to determine, record, or even ask about the originating OS anywhere
in this function or file. It resolves every ambiguous timestamp by magnitude alone, silently,
with a `log.warning` on overflow but no confidence flag on the output value.

This is useful negative evidence, not a design to imitate: it confirms the field has not already
solved this problem (so ForensiX inventing an operator-declared/derived-hybrid answer is not
reinventing a wheel), and it is a concrete illustration of exactly the anti-pattern `#143`'s
`offer_data.expiry` finding warns against — a silent, un-flagged magnitude decode that is
confidently wrong when the ranges are close (`hindsight`'s Webkit-ms band, 12906777600000 to
15000000000000, and a hypothetical adjacent Unix-ms value, are separated by roughly the same order
of ambiguity `#143` found already-defeated in production Chrome data).

### 3.5 Recommendation

**Operator-declared, parallel to `Declared Timezone`, is primary.** `CONTEXT.md`'s existing
pattern — "stated by the investigator... always labelled as declared, never derived" — transfers
directly: an `origin_os` field the operator supplies (or leaves unset), always rendered as
*declared*, never silently promoted to fact. **`SingletonLock` presence is a secondary, corroborating
Candidate-only signal**: if a Working Copy carries a POSIX-shaped `SingletonLock` symlink, the
resolver may emit a `Candidate` (non-Windows) alongside the `unavailable` epoch state, and if that
Candidate *conflicts* with an operator declaration (`origin_os: windows` declared, but a POSIX
`SingletonLock` symlink is present), that conflict itself should be surfaced — this is new
evidence of a possibly wrong declaration, not something to silently prefer one way. `downloads.full_path`
path syntax (`#143` part-1 §1.3(b)) and Manifest-recorded acquisition path syntax (§3.3 above) are
additional, weaker corroborating signals in the same Candidate-only class. **Neither derived signal
is ever sufficient alone** to move a resolution out of `unavailable` into `value`/`Finding` — only
an operator declaration can do that, because it is the only mechanism in this list that is not a
heuristic (§6).

---

## 4. C — Field State when OS is unknown and version is ambiguous

### 4.1 The two cases the issue names, worked through

**History `meta.version <= 16` (magnitude test decisive).** Per `#143` part-1 §1.3(a), Unix-µs
(~1.26×10^15, 16 digits) and 1601-µs (~1.29×10^17, 18 digits) are two orders of magnitude apart for
any date the 2008–2013-era schema could plausibly hold, and cannot overlap. `MAX(last_visit_time)
< 1e16` ⇒ non-Windows; `> 1e17` ⇒ Windows. This is a real, if inferred, discriminator — exactly
what `143-timestamp-epoch-table.yaml`'s row `history/urls/last_visit_time` already encodes as
`ambiguity.discriminators[0]` with `kind: magnitude, basis: inferred, emit_as: candidate`. **Field
State: `unavailable` for the resolved epoch/value, with a `Candidate` emitted alongside it**,
carrying the magnitude-derived OS guess and a confidence note ("decisive for this era, cannot
overlap"). This is stronger than a typical Candidate — it is a two-value, non-overlapping
classification, not a fuzzy ranking — but it is still the output of an inference over the data,
not a verified fact about the data's origin, so it stays a Candidate per `CONTEXT.md`'s
definition ("a ranked possibility produced by a heuristic... never presented as a finding").

**`offer_data.expiry` (magnitude test defeated).** Per `#143` §6.3, 1601-ms and Unix-ms are both
13 digits in 2026 and both decode to a plausible-looking date (369 years apart). No discriminator
of any kind exists for this column in `#143`'s evidence. **Field State: `unavailable`, and no
Candidate is emitted**, because there is nothing to rank — a Candidate requires a mechanism that
narrows the possibility space, and none exists here. Emitting a 50/50 "Candidate" with no basis
would misrepresent an *absence* of a discriminator as the *presence* of a weak one; `unavailable`
alone, with `reason: magnitude_test_defeated`, is the honest output.

### 4.2 The general rule

> When a column's epoch is version-ambiguous and requires OS input that was not supplied: emit
> Field State `unavailable`, with a `reason` drawn from the YAML's existing `ambiguity_states`
> vocabulary (`requires_os_input`, etc.). **Additionally** emit a `Candidate` alongside it **only
> if** a discriminator with a stated, non-empty `basis` (magnitude, sibling-column, or the new
> `SingletonLock`/Manifest-path signals from §3) actually exists and was evaluated for that
> column. If no discriminator exists or none was evaluated, `unavailable` stands alone.

This requires no schema change to `143-timestamp-epoch-table.yaml` — the `ambiguity.discriminators[]`
array already being empty (as it is for `offer_data.expiry`'s row, which has an `ambiguity` block
with no `discriminators` key at all — confirmed by inspection, `research/143-timestamp-epoch-table.yaml`
around the `webdata/offer_data/expiry` row) versus non-empty (as it is for the two History
`requires_os_input` rows) is already the exact signal this rule keys on.

---

## 5. D — Triple vs quintuple, and the `CONTEXT.md` proposal

### 5.1 The synthetic cases, one more than the issue names

`#150`'s comment lists three. `143-timestamp-epoch-table.yaml`'s `synthetic[]` blocks (no new
fetch — already-landed Lane B data, read in full for this ticket) name a **fourth**:

| Value | Written by | Actually records | Source (already in Lane B) |
|---|---|---|---|
| `logins.date_password_modified`, rows predating v30 | `UPDATE ... SET date_password_modified = date_created` | The row's `date_created`, copied — evidences only that the credential predates v30 | `login_database.cc:853-861` |
| `insecure_credentials.create_time`, rows 0 in a v29–v31 DB | `base::Time::Now()` at migration time | A Chrome upgrade, not a compromise discovery | `login_database.cc:863-872` |
| `cookies.expires_utc` at ~+400d in a v>=19 DB | The v19 cap | The cap, not the server-sent expiry (irreversible — original unrecoverable) | `sqlite_persistent_cookie_store.cc:230-232` |
| `Bookmarks.date_added` / `.date_modified`, key missing at parse | `.value_or(base::Time::Now())` on decode, written back on next save | The time Chrome first *parsed* the file, not bookmark creation — **indistinguishable on disk**, and the checksum does not cover this field so editing it goes undetected | `bookmark_codec.cc:367-369, 383-386` |

The fourth case is the strongest argument for the quintuple over the flag-only option: the
Bookmarks case is **not detectable after the fact** by any rule (no equality check, no cluster
test, nothing — `indistinguishable_on_disk: true` in the YAML). A bare `synthetic: true/false`
flag with no `resolution_provenance` cannot express *why* ForensiX believes a given row is
synthetic versus not, which matters because for three of the four cases there is a detection rule
with its own caveats (e.g. the `date_password_modified` equality check has a stated false-positive
case: "*A credential CREATED with a password legitimately gets equal values at insert time*").
Recording *which rule fired, and its caveat* is exactly what "resolution provenance" in option (c)
is for.

### 5.2 Recommendation: (c)

Keep `Field State` at three values. Add `synthetic: bool` beside `value` (not a fourth state,
because option (a) is factually wrong per `#150`'s own framing — "the field genuinely has a
value"). Extend the stored triple to a quintuple:

1. raw value
2. epoch family
3. UTC instant
4. **resolution provenance** — which cascade step (§2) fired, and if a heuristic was used, which
   one (`magnitude_heuristic`, `operator_declared`, `column_sniff_corrected`, etc.)
5. **synthetic flag** — plus, where a detection rule exists, the rule and its caveat (this is
   already exactly the shape of `synthetic[].detection` in `143-timestamp-epoch-table.yaml`; no
   new schema is needed, the quintuple's field 5 is a direct pass-through of that existing data)

This matches the issue author's stated lean and is not a new argument this ticket invented — it is
the direct consequence of the fourth (Bookmarks) case having no detection rule at all, which
neither (a) nor (b) alone can express as cleanly as a `resolution_provenance` field can.

### 5.3 Proposed `CONTEXT.md` wording — PROPOSAL ONLY, not applied here

Per the task instructions, `CONTEXT.md` is **not edited** by this research file. The following is
what `#150`'s comment already drafted, reproduced here as the proposal this ticket endorses, for
the repo owner to apply if accepted:

> **Epoch Family** — which time base a stored timestamp uses. One of: 1601-µs, 1601-ms,
> 1601-seconds, Unix seconds, Unix µs, Unix-ms (JSON double), Omaha days. A property of a
> **column**, at a given database version, from a given originating OS, and only after the
> recorded version has been verified against the schema. Never a property of a file, and never of
> the tool.

> **Declared Timezone** — the suspect's timezone, stated by the investigator. No Chrome artifact
> records the timezone as a setting. One History column persists a locally-derived value from
> which an offset can be recovered (see #143). ForensiX does not use it to derive a timezone.
> Defaults to UTC and is always labelled as declared, never derived. The host's timezone is never
> used.

New, proposed by this ticket (not previously drafted in #150), consistent with the recommendation
in §3.5 and matching the `Declared Timezone` pattern exactly:

> **Declared Origin OS** — the operating system that wrote the Working Copy's Chrome data, stated
> by the investigator. Required only for columns whose `Epoch Family` is platform-conditional at
> the recorded version (History `meta.version <= 16`, Cookies `meta.version <= 3`). A
> `SingletonLock` symlink, when present, may corroborate a non-Windows declaration or flag a
> conflict with one, but its absence proves nothing and it is never sufficient alone. Always
> labelled as declared, never derived.

And the `Finding` amendment, following directly from §6 below:

> **Finding** — an assertion ForensiX makes as fact. Only a `value` with provenance, resolved
> without reliance on a heuristic, can be one. A `value` resolved by magnitude test or any other
> heuristic discriminator is a `Candidate`, never a `Finding`, regardless of how decisive the
> heuristic appears.

---

## 6. E — Where the table lives (pointer only, not redone)

Answered in full by Lane B: `research/143-timestamp-epoch-table.yaml` (99 rows, machine-checked —
unique ids, controlled vocabularies, non-empty provenance, `kind: timestamp` ⇒ has `epoch` or
`ambiguity`) plus `research/_raw/143-epoch-table-NOTES.md` §3 ("data or code?"). Conclusion:
**data for the facts** (epoch family, version range, platform, sentinel, synthetic entry,
verified-negative, provenance), **code for the resolver** (the `FixVersionIfNeeded`-style
column-sniffing ladder, the magnitude fallback, the table-generation dispatch for the address
reorganisation) — with the code loading the table rather than restating it. This design's §2
cascade *is* that resolver procedure; every step reads directly off fields the YAML already has
(`epoch[]`, `ambiguity`, `ambiguity.discriminators[]`, `sentinels[]`, `synthetic[]`). Nothing in
§2–§5 requires a schema addition to the YAML — the quintuple's field 5 is already present as
`synthetic[].detection`, and field 4 (`resolution_provenance`) is a direct label naming which
existing YAML mechanism fired, not new data to collect.

---

## 7. F — Does a heuristically-resolved column ever get a `Finding`?

**No**, under the current, unmodified `CONTEXT.md` definitions (`Candidate`: "never presented as a
finding"; `Finding`: "only a `value` with provenance"). Two worked cases:

- **`offer_data.expiry`-class** (no discriminator exists at all): falls straight to `unavailable`
  per §4.1. There is no ranked possibility to call a Candidate, so there is nothing that could even
  be mistaken for a Finding. This is the strict floor case.
- **History-`v<=16`-class** (magnitude test decisive): reaches `Candidate` status because a
  genuine, cited, non-overlapping discriminator exists (§4.1). It is still never a `Finding` on
  the strength of the heuristic alone — **but it can become one if the operator supplies a
  `Declared Origin OS`** (§5.3's proposed term). At that point the resolution is no longer
  heuristic: it is a verified `(column identity, corrected schema version, declared OS)` triple,
  exactly the resolution class step 3 of the §2 cascade treats as authoritative, carrying
  `resolution_provenance: operator_declared` rather than `resolution_provenance: magnitude_heuristic`
  in the quintuple from §5.2. The magnitude test and the operator declaration can *disagree* (§3.5)
  — when they do, that disagreement is itself reportable (a flag on the Manifest or case record,
  not a silent override in either direction), but that is a presentation/workflow question outside
  this ticket's scope, consistent with `#150`'s own closing note that "*the rendering path can
  still throw the answer away*" and must not be allowed to.

This is not a new rule invented for this ticket — it is the direct, mechanical consequence of
`CONTEXT.md`'s existing `Candidate`/`Finding` split, applied to the two concrete column classes
`#143` and this ticket's §2–§4 worked through. No change to the `Candidate`/`Finding` definitions
themselves is proposed beyond the one line in §5.3 making the "never a Finding" consequence
explicit for magnitude-resolved values specifically (the current wording already implies it; the
proposed wording states it, because #150's comment explicitly flagged that the author did not
think this consequence had been consistently applied: *"I do not think we have been treating it
that way."*).

---

## 8. Verification queue

Ranked by what a wrong answer would cost, same convention as `#143` §10.

- **VQ-1 — Windows Chrome's `lockfile` under an unclean shutdown, or crash-recovery scenarios.**
  Not investigated here: whether a Windows `lockfile` can survive on disk after a crash (rather
  than a clean `FILE_FLAG_DELETE_ON_CLOSE` exit), which would make its *presence* diagnostic of
  Windows origin the same way `SingletonLock`'s presence is diagnostic of non-Windows origin. If a
  crash-surviving `lockfile` is common, the discriminator in §3.5 becomes two-directional rather
  than one-directional, which would strengthen (not weaken) the Candidate case. Needs either a
  live-crash test or deeper reading of `CreateLockFileWithTimeout`'s callers and any Windows
  crash-handling path that runs before the handle closes.
- **VQ-2 — Whether the Manifest schema (`#121`, still "not yet chosen" per that brief's own §9
  gap list) will in fact carry an `origin_os` or equivalent field.** This design assumes it can be
  added (§5.3's `Declared Origin OS` proposal), but the Manifest schema itself is an open decision
  in `#121`, not settled by this ticket. Flagging the dependency, not resolving it.
- **VQ-3 — Whether other platforms (Linux specifically, vs macOS) produce an identical
  `SingletonLock` shape.** `process_singleton_posix.cc` is shared between macOS and Linux builds
  (`BUILDFLAG(IS_POSIX)`, with `BUILDFLAG(IS_MAC)`-gated sub-branches for edge cases like
  `ReplaceOldSingletonLock`). The symlink-creation code at lines 1013-1021 is not inside any
  platform-specific `#if`, so it should be identical on both — but this was read, not tested
  against a real Linux capture. `#143`/`#117`'s fixture is macOS-only (`research/artifacts/117-chrome151-macos/`).
  A Linux fixture would close this.
- **VQ-4 — `hindsight`'s repository-transfer history.** The GitHub API redirects
  `obsidianforensics/hindsight` → `RyanDFIR/hindsight` (HTTP 301, confirmed live). Not
  investigated: whether this is a fork, a rename, or an org transfer, or whether
  `obsidianforensics/hindsight` (the org the issue explicitly names) still exists as an
  independent, differently-maintained codebase. The content fetched and cited in §3.4 is from
  `RyanDFIR/hindsight`'s `main` branch at fetch time; if the two have diverged, this citation
  applies to the fork actually reachable today, not necessarily to whatever code the issue's
  author had in mind.
