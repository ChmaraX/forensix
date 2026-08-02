# Research: Legal, ethical and practical constraints on shipping a public OSS tool that decrypts saved Chrome credentials

**Issue:** ChmaraX/forensix#122 — should ForensiX v2 decrypt Chrome `Login Data` passwords and `Cookies` values? (v1 dumped ciphertext as hex.) Feeds the credential-decryption policy decision in **#124**.

---

## ⚠️ Read this first — provenance of this brief

**This session had no web search and no page fetch tool.** Available tools were Read / Write / intercom only. Nothing below was retrieved or re-read in this run. This is a knowledge-based brief, tagged so the parent can verify top-down.

**This is not legal advice.** It reports (a) what statutes textually say, (b) what the enforcement record appears to be, and (c) what practitioners believe. Those three are different things and are tagged separately throughout, because conflating them is exactly how a legal claim becomes dangerously overconfident.

### Tag scheme

**Confidence tags**
- `[VK]` **VERIFIED-BY-KNOWLEDGE** — durable, structural, long-stable; I would stake the decision on it.
- `[UV]` **UNVERIFIED** — needs a live check. Every `[UV]` item has a verification URL, what to look for, and the expected answer shape in §7.

**Claim-type tags** — which *kind* of assertion this is:
- `(TEXT)` — what a statute/policy document textually says. Checkable, binary.
- `(ENF)` — what has actually been prosecuted/enforced. Absence of evidence ≠ evidence of absence; I flag where my knowledge of the record is thin.
- `(CONS)` — practitioner/community consensus or professional practice. Not law. Persuasive at most.
- `(TOOL)` — what a specific named tool does today. **Treated as UNVERIFIED by default per steering.**
- `(POLICY)` — private platform policy (GitHub, AV vendors). **Treated as UNVERIFIED by default per steering.**

---

## 1. Summary

`[VK]` `(TEXT)` **No mainstream jurisdiction criminalises decrypting data you lawfully possess.** Every relevant offence in the US, EU, DE and UK is keyed to *unauthorised access*, not to the act of decryption.

`[VK]` `(TEXT)` **The author/distributor risk is narrow and concentrated in one legal family: "misuse of devices" / tool-supply offences.** In the US the CFAA has no general tool-supply offence at all. In the EU it exists — Directive 2013/40/EU Art. 7, German StGB § 202c, UK CMA 1990 s.3A — but all three are textually qualified by intent and/or a "designed primarily for" test.

`[VK]` `(CONS)` / `[UV]` `(ENF)` **Practitioner consensus is that these provisions do not reach published dual-use security/forensic tooling; my knowledge of the actual prosecution record supports that but is not a systematic survey.** I am confident about the consensus. I am *less* confident asserting "no publisher has ever been prosecuted" as a fact — see §7 rank 4.

`[VK]` `(CONS)` **The single genuine outlier is UK CMA s.3A(2)**, whose "believing it is likely to be used" limb has no statutory legitimate-purpose defence. This is the specific provision the UK security industry has campaigned to reform for a decade. It is the one place where a careful maintainer's design choices genuinely matter.

`[VK]` `(CONS)` **The ecosystem has already resolved this empirically.** Multiple openly hosted OSS tools do exactly this decryption with far more aggressive framing than ForensiX would use. Nobody refuses on legal grounds; the forensic-side tools that *don't* decrypt decline on **scope** grounds, not legal ones.

`[VK]` `(TEXT)` **The decisive variable is capability shape, not the word "decrypt."** A tool that requires (i) offline artifacts and (ii) operator-supplied key material sits on a different side of the Art. 7 "designed or adapted **primarily** for" test than a live-host one-click harvester. That is a *design* lever ForensiX controls.

### Options actually available to this project

| # | Option | Distribution-risk posture | Forensic utility | Verdict |
|---|--------|---------------------------|------------------|---------|
| **A** | **Never decrypt** (v1 status quo: hex ciphertext) | Lowest | Low | Zero incremental risk, zero differentiation. Note the perverse effect: emitting ciphertext hex invites the examiner to paste it into an offensive tool, which is *worse* for chain of custody than either decrypting properly or omitting the field. |
| **B** | **Offline, opt-in, operator-supplied key material.** `--decrypt` off by default; requires DPAPI masterkey / account password / Keychain password from the operator; no key extraction from a live host; redacted by default; lawful-authority assertion recorded in the report | Low. Structurally matches the offline-forensics model | High — what an examiner actually needs | **The mainstream defensible shape.** Fails the Art. 7 "primarily designed for" test and lands well on the UK dual-use prosecution factors. |
| **C** | **Option B in a separate optional module/repo** (`forensix-decrypt`) | Low, and isolates the core tool's packaging/AV reputation surface | High, small UX cost | Worth it if AV/EDR false-positive flagging of a compiled binary is a concern. Orthogonal to the legal question; this is an operational hedge. |
| **D** | **Decryption on by default, auto-extracting keys from the running host** | Highest — this is infostealer shape | High but indistinguishable from a credential harvester | Not prohibited (tools of this shape are hosted publicly today), but forfeits the forensic framing and is the only option where Art. 7 / s.3A arguments become non-trivial rather than academic. |

**If #124 needs one sentence:** B or C are defensible on the current understanding of the law and match how offline forensic decryption tools already present themselves; D is legal-but-unwise; A is safe-but-inert.

---

## 2. Legal exposure for the author/distributor

### 2.1 United States — CFAA, 18 U.S.C. § 1030

`[VK]` `(TEXT)` **The CFAA has no general tool-distribution offence.** It criminalises *access* without authorisation or exceeding authorised access (§ 1030(a)(2), (a)(5)). Publishing software is not an access.

`[VK]` `(TEXT)` **§ 1030(a)(6) is the only trafficking limb**, and it prohibits knowingly and **with intent to defraud** trafficking in "any password or similar information through which a computer may be accessed without authorization." Two reasons it does not reach ForensiX: a tool is not a password, and there is no intent to defraud. I am confident about both the existence of the provision and its intent element.

`[VK]` `(TEXT)` ***Van Buren v. United States*, 593 U.S. 374 (2021)** adopted a "gates-up-or-down" reading of "exceeds authorized access," rejecting purpose-based liability. This protects an examiner authorised to be on the machine/image.

`[UV]` `(TEXT)` **DOJ's May 2022 CFAA charging policy** directs prosecutors not to charge good-faith security research. I am confident this policy exists and has that direction; I am **not** confident quoting its definition of "good faith," and forensic tooling is not squarely "security research" under it. → §7 rank 7.

**Adjacent US regimes:**

`[UV]` `(TEXT)` **DMCA § 1201(a)(2) anti-trafficking.** Theoretical only. The doctrinal fit is poor — Chrome's DPAPI/Keychain wrapping protects user data, not access to a copyrighted work — and § 1201(j) plus the Librarian of Congress's renewed good-faith security-research exemption point away. `[VK]` `(ENF)` **I know of no § 1201 action against a forensic decryption tool.** Confidence: high on absence of enforcement, medium on the doctrinal analysis. Not a driver for #124.

`[UV]` `(TEXT)` **Export control (EAR).** Publicly available open-source encryption *source code* is relieved from control under § 734.7 / § 742.15(b), subject to a notification email to BIS and NSA. This is a cheap one-off compliance step many crypto-touching OSS projects perform. `[VK]` `(TEXT)` The **Wassenaar "intrusion software"** controls target software for defeating protective countermeasures on a *remote* system and are a poor fit for offline local decryption; published source code is in any case excluded. → §7 rank 8. Low blast radius; a five-minute action item at most.

**Bottom line (US):** `[VK]` distributor exposure is very low. Risk sits with a user who accesses a system they are not authorised to access.

### 2.2 EU — Directive 2013/40/EU, Article 7

`[VK]` `(TEXT)` **Art. 7 requires Member States to criminalise** the intentional production, sale, procurement for use, import, distribution or otherwise making available of (a) a computer programme **designed or adapted primarily for the purpose of** committing any Art. 3–6 offence, or (b) a password/access code, **with the intention that it be used** to commit such an offence.

`[VK]` `(TEXT)` **Two limiters do all the work:** the objective "designed or adapted primarily for" test, and the subjective intent requirement. Both must be satisfied.

`[UV]` `(TEXT)` **Recital 16** disclaims criminal liability where the objective elements are met but the acts lack criminal intent, giving mandated testing/protection of information systems as an example. I am confident a legitimate-purpose recital exists and has this effect; I am **not** confident quoting it verbatim or citing the recital number. → §7 rank 3.

`[VK]` `(TEXT)` The Directive descends from **Art. 6 of the Budapest Convention (ETS 185)** on misuse of devices, whose **Art. 6(2)** expressly excludes tools produced for authorised testing/protection. Same structural carve-out, older.

#### Germany — StGB § 202c

`[VK]` `(TEXT)` § 202c criminalises preparing a § 202a (Ausspähen von Daten) or § 202b (Abfangen von Daten) offence by producing, procuring, selling, supplying, distributing or otherwise making available passwords/access codes or **computer programs whose purpose is the commission of such an act**. Introduced in 2007 implementing the EU Framework Decision.

`[VK]` `(TEXT)` **§ 202a additionally requires** that the data be **"besonders gesichert"** (specially protected) and that the offender **overcome that protection**, and that the data not be intended for the actor. An examiner working an image with lawfully held key material satisfies none of those.

`[VK]` `(CONS)` **§ 202c caused a genuine chilling event in 2007–08** — heavy criticism from the CCC and Gesellschaft für Informatik, symbolic shutdowns/offshore relocations by German security-tool authors, and constitutional complaints. This is well-established history.

`[UV]` `(TEXT)` **The Bundesverfassungsgericht declined to accept the § 202c constitutional complaints (2009) but set out a narrowing construction** to the effect that (i) the program must be *objectively* designed to commit a § 202a/b offence, so a genuine dual-use tool merely *capable* of misuse is not covered; and (ii) intent to prepare a concrete offence is required — with the consequence that IT-security professionals producing analysis tools are not caught. **I am confident this decision exists and has this direction. I am not confident on docket numbers or exact date, and the holding language should not be quoted from this brief.** → §7 rank 2 (high blast radius: this is the load-bearing authority for the "dual-use is fine in Germany" position).

`[UV]` `(ENF)` **Modern Solution case (2023–24):** a researcher was convicted at first instance under § 202a for extracting a hardcoded database password and **acquitted on appeal** on the ground that a hardcoded password is not an adequate "besondere Sicherung." Direction of travel is right; court names, dates and outcome details need checking. Relevant as evidence that German prosecutors *will* bring researcher cases — but this was **access**, not tool distribution. → §7 rank 6.

`[UV]` `(TEXT)` **A Federal Ministry of Justice reform draft adding a good-faith security-research exemption to §§ 202a ff. has been circulating since ~late 2024. Its current status is unknown to me. Do not rely on it.** → §7 rank 6.

`[UV]` `(TEXT)` **Other Member States:** France's Art. 323-3-1 Code pénal contains an express "motif légitime, notamment de recherche ou de sécurité informatique" exception — the clearest statutory model of a legitimate-purpose safe harbour. NL Art. 139d Sr is the Dutch analogue. Article/section numbers unverified.

#### United Kingdom — CMA 1990 s.3A

`[VK]` `(TEXT)` **s.3A (inserted by the Police and Justice Act 2006) creates three limbs:**
- **s.3A(1)** — makes/adapts/supplies/offers to supply an article **intending** it to be used to commit or assist a CMA offence;
- **s.3A(2)** — supplies or offers to supply an article **believing that it is likely to be used** to commit or assist such an offence;
- **s.3A(3)** — obtains an article with a view to its supply under (1) or (2).

`[VK]` `(TEXT)` **s.3A(2) is the genuinely problematic provision for OSS publishers.** A belief-about-likelihood standard, with **no statutory legitimate-purpose or public-interest defence**. This is textual and durable, and it is the single strongest legal point in this brief.

`[UV]` `(TEXT)` The Serious Crime Act 2015 amended s.3A to pick up the then-new s.3ZA offence; I believe the "likely to be used" wording of s.3A(2) **survived** that amendment unchanged, but the current consolidated text should be read. → §7 rank 2.

`[UV]` `(TEXT)` **CPS legal guidance on the Computer Misuse Act** instructs prosecutors, for dual-use articles, to consider factors including: does the article have a legitimate purpose and is it in fact widely used for legitimate purposes; is it available on a wide scale commercially / through legitimate channels; was it developed primarily, deliberately and for the sole purpose of committing a CMA offence; in what context was it made available (open professional distribution vs. closed criminal forum); and what thought was given to who would use it. **I am confident such guidance exists with substantially these factors; the exact list and wording must be checked, and it is worth checking because these factors are directly actionable as design requirements.** → §7 **rank 1** — highest blast radius, because it converts abstract legal risk into a concrete checklist ForensiX can satisfy.

`[UV]` `(CONS)` The **CyberUp campaign** and the Home Office CMA review (call for information 2021, response 2023) reflect sustained UK practitioner argument that s.3A(2) and s.1 are overbroad. `[UV]` **My understanding is that no statutory defence has been enacted; verify.** → §7 rank 5.

`[UV]` `(ENF)` **Enforcement record.** My understanding is that UK s.3A prosecutions have involved RAT trafficking and booter/stresser services — i.e. supply contexts that were unambiguously criminal — and that I know of no prosecution of an author of a published, general-purpose, dual-use security or forensic tool under s.3A or § 202c. **State this carefully: this is my knowledge of the record, not a systematic survey, and I cannot cite specific case names with confidence.** → §7 rank 4.

`[VK]` `(CONS)` **Practitioner consensus, stated plainly:** the offence bites on supply *context* and *intent*, not on capability. Publishing a documented forensic tool openly, under a maintainer's real identity, with an intended-use statement, is the opposite of the fact pattern these provisions were written for. I am confident in this as consensus. It is not a guarantee, and s.3A(2) is why nobody in the UK security industry is willing to call it one.

---

## 3. How comparable open-source forensic tools handle it

**Per steering, every row here is `[UV]` `(TOOL)` — tool behaviour changes and must be checked against the current repo.** I mark my prior confidence separately so the parent knows where verification is likely to confirm vs. surprise.

| Tool | Decrypts Chrome credentials? | Gating | Prior confidence | Notes |
|---|---|---|---|---|
| **plaso / log2timeline** | **No** | n/a | High | Chrome parsers (`chrome_history`, `chrome_cookies`, `chrome_extension_activity`, `chrome_cache`, `chrome_preferences`) extract timestamped events and metadata. **The rationale is scope, not law** — plaso is a timeline engine and a credential value is not a timeline event. Important: this is *not* a peer project declining on legal grounds. |
| **Hindsight** (obsidianforensics / Ryan Benson) | **Unknown — must check** | Unknown | **Low** | Parses `Login Data` and `Cookies`. Whether it decrypts DPAPI/Keychain-wrapped values, whether that is flag-gated, and any stated rationale are the **single most decision-relevant unknowns in this brief**. → §7 **rank 1 (tied)**. |
| **Impacket `dpapi.py`** (Fortra) | **Yes — offline** | Explicit subcommands; mandatory operator-supplied key material | High | The canonical defensible shape: `dpapi.py masterkey -file <mk> -sid <SID> -password <pw>`, then decrypt blobs with the derived key. **It cannot operate on a stranger's data.** Shipped in a mainstream, widely packaged library. |
| **dpapick / dpapick3** | **Yes — offline forensic DPAPI** | Requires user password or system key | Medium-high | Explicitly framed as forensic reconstruction from an acquired image. |
| **SharpDPAPI / SharpChrome** (GhostPack) | **Yes** | Offensive by design; separates live triage commands from offline `/pvk`-based commands | Medium-high | Red-team framing, engagement-scoped documentation. Publicly hosted. |
| **LaZagne** | **Yes, automatic** | None | High | Zero-argument local credential retrieval. Publicly hosted since ~2015, thousands of stars. Universally AV-flagged as HackTool. |
| **HackBrowserData** | **Yes, one command, cross-browser/cross-OS** | None; README disclaimer only | Medium-high | The most infostealer-shaped popular OSS tool. Still hosted. |
| **mimikatz `dpapi::chrome`** | **Yes** | None | High | Notable because the author is French, where § 323-3-1 has an express legitimate-motive exception; published for over a decade. |
| **NirSoft ChromePass** (closed freeware) | **Yes** | None | High | The practical cautionary case: persistently classified HackTool/riskware/PUA by AV vendors. A *distribution* problem entirely independent of law. |
| **Commercial suites** — Magnet AXIOM, Belkasoft X, Elcomsoft, Passware | **Yes** | **Commercial gate**: purchase, licence terms, sometimes LE/corporate-only vetting | High | Proves decryption is standard, expected forensic functionality. Their control is access-to-the-tool gating, which an OSS project structurally cannot replicate — this is the one safeguard unavailable to ForensiX. |

`[VK]` `(CONS)` **The pattern, which I am confident about even though individual rows need checking:** the forensic side either declines on **scope** grounds (plaso), or decrypts **offline with operator-supplied key material** (Impacket, dpapick), or gates behind **commerce** (Magnet/Elcomsoft). The offensive side decrypts freely and carries only a disclaimer. **No project in either camp refuses on legal grounds.** If verification finds a project that *does* refuse on stated legal grounds, that would be a genuine surprise and should be escalated into #124.

---

## 4. Standard safeguards used by dual-use tooling

`[VK]` `(CONS)` These are observed conventions, ordered by how much they actually accomplish. This section is practice, not law.

1. **Capability shaping — the only safeguard with real legal weight.**
   - Require **offline artifacts** (copied `Local State` + `Login Data` + `Cookies`), not a live host.
   - Require **operator-supplied key material** (Windows account password / DPAPI masterkey / SID; macOS Keychain password; Linux keyring secret). Do not silently scrape the logged-in user's keys.
   - **No network egress on the credential path, ever.** A credential tool that phones home is an exfiltration tool.
   - **Redact/hash by default**; require a second explicit flag for plaintext.
   `[VK]` `(TEXT)` This is what defeats the Art. 7 / § 202c "designed **primarily** for" test and what maps onto the UK dual-use factors. It is the substantive safeguard; everything below is supporting evidence of good faith.
2. **Opt-in flag** — decryption off by default behind a verbose flag (`--decrypt-credentials`, not `-d`), plus interactive confirmation for the plaintext path.
3. **Assertion of lawful authority** — e.g. `--authority "<case ref / warrant / consent basis>"`, written with operator identity and UTC timestamp into the report header and an append-only audit log. `[VK]` `(CONS)` This creates **no legal defence for the author**. What it does: (a) evidences that the author considered who would use it — an express UK dual-use factor; (b) supports the examiner's own chain-of-custody obligations under ACPO/NPCC digital-evidence principles, ISO/IEC 27037 and SWGDE practice. Do not oversell it internally as a shield.
4. **Explicit intended-use statement** in README and `--help`, naming lawful contexts (own device; consented corporate investigation; lawfully seized image under warrant). `[VK]` `(CONS)` **Language matters more than people expect** — "recover / decrypt for examination", never "steal / dump / harvest". Repo prose is the first thing a prosecutor, journalist or AV analyst reads.
5. **Licence disclaimers** — MIT "AS IS"; Apache-2.0 §§ 7–8. `[VK]` `(TEXT)` **These disclaim civil warranty and liability between author and user. They do not touch criminal liability and do not bind third parties.** `[VK]` `(CONS)` Adding a bespoke "no unlawful use" clause converts the licence into a non-OSI, use-restricted licence (the JSON "do no evil" / Commons Clause problem). Standard practice is to keep an OSI licence and put the restriction in a non-binding README / `USAGE_POLICY.md`.
6. **Runtime warning banner** on the decryption path (one-time, to stderr) restating intended use.
7. **Separating the sensitive capability** into an optional module/plugin/repo so the core tool stays clean for packaging, CI and AV reputation.
8. **`SECURITY.md` / responsible-use policy + a documented maintainer policy** refusing features that extend toward live-host harvesting or exfiltration. Evidence for the "what thought was given to who would use it" factor.
9. **Export-control housekeeping** — the BIS/NSA publicly-available-source-code notification if the project ships crypto implementations. Cheap, commonly done. `[UV]` → §7 rank 8.

---

## 5. GitHub's policy on offensive / dual-use security tooling

**Per steering, the entire policy-wording portion of this section is `[UV]` `(POLICY)`.** GitHub's Acceptable Use Policies are revised periodically and I should not be quoted on current wording.

`[UV]` `(POLICY)` Governing documents: **GitHub Acceptable Use Policies**, specifically the **"Active Malware or Exploits"** section, reflected also in the Community Guidelines, substantially rewritten in **June 2021** after backlash over the removal of a ProxyLogon proof-of-concept.

`[UV]` `(POLICY)` My understanding of the operative positions:
- GitHub **explicitly permits dual-use content**, stating it supports posting exploits, malware samples and security research content for research and education, and recognises legitimate value to the security community.
- What is prohibited is using GitHub **in direct support of unlawful attacks that cause technical harm** — delivering malicious executables to victims, acting as C2 or as an exfiltration endpoint.
- GitHub says it considers **real-world context and intent**, may **restrict rather than remove** dual-use content, and post-2021 committed to notifying project owners and offering appeals.

→ §7 rank 3.

`[VK]` `(ENF)` **The empirical point is stronger than the policy wording and I am confident in it:** LaZagne, HackBrowserData, SharpDPAPI and mimikatz — all of which perform exactly the Chrome credential decryption in question, with far more aggressive framing than ForensiX would use — are hosted on GitHub. **Takedown risk for a forensic parser is negligible.** For #124, this is the finding that matters; the exact policy prose is confirmatory detail.

`[VK]` `(POLICY)` **Separate, unrelated removal vectors** exist and should not be conflated with the malware policy: DMCA takedown (the 2020 youtube-dl removal and reinstatement, after which GitHub created a Developer Defense Fund and revised its § 1201 review) and trade-sanctions/export screening. Neither is implicated here.

`[VK]` `(CONS)` **The residual practical risk is not GitHub, it is downstream packaging and AV.** PyPI/npm/Homebrew have no equivalent ban, but Windows Defender / SmartScreen / EDR heuristics may flag a compiled binary that reads `Login Data` and calls `CryptUnprotectData`. This is the strongest argument for **Option C** and for shipping source rather than unsigned binaries. `[UV]` The specific detection behaviour is untested — worth an empirical check once a build exists, not a literature question.

---

## 6. Lawfully-possessed artifacts vs. building a harvesting capability

### For the examiner: the distinction is decisive

`[VK]` `(TEXT)` Every relevant offence keys to unauthorised access:
- **CFAA** § 1030(a)(2)/(a)(5) — "without authorization or exceeding authorized access."
- **StGB § 202a** — data **not intended for the actor**, **specially protected**, access obtained by **overcoming that protection**.
- **CMA s.1** — access the person is **not entitled** to cause, knowing it is unauthorised.

An examiner on a lawfully seized image under warrant, on their own device, or with documented consent, is authorised. **Decryption of already-possessed data is not a separate offence in any of these regimes.**

`[UV]` `(TEXT)` Adjacent regimes constrain *method and documentation*, not legality: UK RIPA Part III s.49/s.53 compelled key disclosure runs **against a suspect**, not an examiner; evidence-handling rules (ACPO principles on documenting changes) govern process. Section numbers unverified; low blast radius.

### For the distributor: partially, and less than one would like

`[VK]` `(TEXT)` **Under Directive 2013/40 Art. 7 / § 202c the distinction maps directly onto the statutory test.** A tool that structurally requires an already-possessed artifact set *and* already-possessed key material is not "designed or adapted **primarily** for" committing an unauthorised-access offence. **This is the strongest form of the argument and it is a real one, not a rationalisation.**

`[VK]` `(TEXT)` **Under UK s.3A(2) the distinction is evidential, not definitional.** The offence turns on the supplier's belief about likely use, so the existence of a lawful use does not by itself answer the question. `[UV]` `(CONS)` But it is precisely where the CPS dual-use factors land, and the marginal capability such a tool adds to an attacker *who already holds the masterkey* is close to zero — which makes a "believed likely to be used to commit an offence" claim hard to sustain. **Say this as an argument available to the maintainer, not as a settled answer. It is not settled.**

`[VK]` `(CONS)` **Novelty matters.** Chrome credential decryption is thoroughly documented and implemented in a dozen public tools. ForensiX adding it grants no new capability to an attacker. Ubiquity is not a legal defence in itself, but it bears directly on "primarily designed for", on "likely to be used", and on any public-interest assessment.

### Does the distinction show up in how tools present themselves? Yes, visibly

`[UV]` `(TOOL)` — verify per §3, but the presentational pattern is what matters:
- **Impacket `dpapi.py` / dpapick** document the offline masterkey workflow first and *require* `-password`/`-pvk`/`-key`. You literally cannot run them against a stranger's data.
- **SharpDPAPI** documents both but separates live *triage* commands from `/pvk`-based *offline* commands, framed for scoped engagements.
- **LaZagne / HackBrowserData** present as zero-argument run-and-dump — and are correspondingly treated as offensive tooling by AV vendors and defenders.
- **Commercial suites** foreground case management, authority/warrant fields and audit logs, placing decryption inside a workflow rather than exposing it as a standalone verb.

`[VK]` `(CONS)` **The lesson for ForensiX:** category membership is not determined by the presence of a `--decrypt` flag. It is determined by (i) whether the tool can operate without the operator demonstrating possession of key material, and (ii) whether the documentation addresses an examiner with a case file or a user with someone else's laptop.

### Practical constraint that may partly moot the feature: Chrome App-Bound Encryption

`[UV]` `(TOOL)` Since roughly **Chrome 127 (mid-2024)** on Windows, Google introduced **App-Bound Encryption (ABE)** for cookies — blobs prefixed `v20` — binding the key to the Chrome executable via a SYSTEM-privileged elevation service, explicitly to break infostealers abusing DPAPI in user context.

Consequences if confirmed:
- `v10`/`v11` blobs remain decryptable from `Local State` + the user's DPAPI masterkey (AES-256-GCM path).
- `v20` blobs require the **SYSTEM DPAPI key**, meaning offline forensics needs that key material captured from the image — meaningfully harder and a real support burden.
- `[UV]` Google signalled intent to extend ABE beyond cookies to passwords and payment data. **Whether that has landed, and for which artifact, is unknown to me.**

→ §7 **rank 2** — high blast radius for #124, because if ABE now covers `Login Data` on current Windows profiles, the *value* of the feature drops sharply and the cost/benefit for Option B changes even though the legal analysis does not.

`[VK]` `(TOOL)` macOS uses the login Keychain item `Chrome Safe Storage` (PBKDF2 → AES-128-CBC); Linux uses `Chrome Safe Storage` via Secret Service/kwallet with a hardcoded `peanuts` fallback. Both require operator-supplied secrets in the offline case — which conveniently aligns with the defensible design.

---

## 7. UNVERIFIED items, ranked by blast radius for #124

Ranked by how much the decision changes if the check comes back other than expected.

| # | Item | URL to check | What to look for | Expected answer shape |
|---|---|---|---|---|
| **1a** | **Hindsight's current credential-decryption behaviour and rationale** `(TOOL)` | https://github.com/obsidianforensics/hindsight — README, CHANGELOG, and issue search for `decrypt` / `DPAPI` / `Local State` | Does it decrypt `Login Data` / `Cookies`? Is it flag-gated? Any maintainer statement of rationale in README or issue threads? | One of: (a) no decryption; (b) decryption always on; (c) decryption behind a flag / requires key material. **Any explicit legal rationale from Benson is the highest-value quote available for #124.** If (a) with a stated legal reason, that materially strengthens Option A. |
| **1b** | **CPS dual-use prosecution factors** `(TEXT)` | https://www.cps.gov.uk/legal-guidance/computer-misuse-act | The section on articles/dual-use under s.3A: the enumerated factors prosecutors weigh | A bulleted factor list. **Convert it verbatim into a design checklist for Option B.** This is the most actionable single document in the brief. |
| **2a** | **CMA s.3A current consolidated text** `(TEXT)` | https://www.legislation.gov.uk/ukpga/1990/18/section/3A | Whether s.3A(2) still reads "believing that it is likely to be used"; what SCA 2015 changed | Confirm/deny the "likely" limb survives. If it were narrowed to intent-only, UK risk drops to near-nil and the whole UK section softens. |
| **2b** | **BVerfG § 202c narrowing construction** `(TEXT)` | https://www.bundesverfassungsgericht.de/ — search "202c"; the 2009 Nichtannahmebeschluss (2 BvR 2233/07 and joined complaints) | Exact docket numbers, date, and the language on dual-use tools and required intent | A Nichtannahmebeschluss with a narrowing reading. **This is the load-bearing authority for "dual-use is fine in Germany"; if my recollection of its scope is wrong, the German analysis needs rebuilding.** |
| **2c** | **Chrome App-Bound Encryption scope in 2025** `(TOOL)` | https://security.googleblog.com/ (Aug 2024 post "Improving the security of Chrome cookies on Windows") + Chromium docs/source for `v20` prefix handling; also check whether `Login Data` uses ABE | Does ABE now cover saved passwords, or cookies only? What key material does offline decryption require? | Cookies-only, or cookies+passwords. **If passwords are ABE-protected on current builds, the feature's value on modern Windows profiles collapses and #124 should weigh that against implementation cost.** |
| **3a** | **Directive 2013/40/EU Art. 7 + legitimate-purpose recital** `(TEXT)` | https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32013L0040 | Exact Art. 7 wording; find the recital disclaiming liability absent criminal intent and giving mandated testing as an example; note its number | Art. 7 as described; a recital in the 15–17 range. Confirms the carve-out exists and gives a citable number. |
| **3b** | **GitHub Acceptable Use Policies — Active Malware or Exploits** `(POLICY)` | https://docs.github.com/site-policy/acceptable-use-policies/github-acceptable-use-policies and https://github.blog/2021-06-04-updates-to-our-policies-regarding-exploits-malware-and-vulnerability-research/ | Current wording on dual-use content; the "direct support of unlawful attacks that cause technical harm" line; restrict-vs-remove and appeal commitments | Explicit permission for dual-use security content with a narrow prohibition. Low risk of surprise given §5's empirical evidence, but the wording should be quoted accurately if cited in the issue. |
| **4** | **Enforcement record: s.3A / § 202c prosecutions of legitimate tool publishers** `(ENF)` | CPS case reports; BAILII; German case-law databases; search terms "section 3A Computer Misuse" + "supplying articles", "§ 202c StGB Verurteilung" | Any prosecution of an author of a published, general-purpose, dual-use tool (as opposed to RAT/booter traffickers) | Expected: none found; prosecutions cluster on RAT sales and stresser services. **If a counter-example exists it is the most important fact in this brief and should be escalated immediately.** |
| **5** | **UK CMA reform status** `(TEXT)` | https://www.gov.uk/ — Home Office CMA review response (2023) and any subsequent legislation; CyberUp campaign site | Has any statutory defence to s.1/s.3A been enacted? | Expected: no defence enacted as of now. Would only improve the picture. |
| **6a** | **German § 202a/§ 202c reform draft status** `(TEXT)` | https://www.bmj.de/ — Referentenentwurf on Strafbarkeit des Hackings / security-research exemption | Enacted, in Bundestag, or lapsed? | Expected: not yet in force. **Do not rely on it either way.** |
| **6b** | **Modern Solution case details** `(ENF)` | German legal press (heise, netzpolitik) and case reports | Court names, dates, appellate reasoning on "besondere Sicherung" | Conviction at first instance, acquittal on appeal. Illustrative only — concerns access, not distribution. |
| **7** | **DOJ May 2022 CFAA charging policy** `(TEXT)` | https://www.justice.gov/opa/pr/justice-department-announces-new-policy-charging-cases-under-computer-fraud-and-abuse-act | Definition of "good-faith security research"; whether forensic tooling plausibly falls inside | Expected: a good-faith research carve-out that does not squarely cover forensic tooling. Directional comfort only; US risk is already assessed as very low. |
| **8** | **EAR publicly-available-source-code notification** `(TEXT)` | https://www.bis.doc.gov/ — EAR §§ 734.7, 742.15(b) | Whether a notification email to BIS/NSA is required for published crypto source, and the current addresses | Expected: notification-only, no licence. **Lowest blast radius — a five-minute action item, not a decision input.** |

---

## 8. Sources

**All URLs below are from memory and were not fetched in this run.** Treat as pointers for verification, not as citations.

**Statutes, directives, official policy**
- 18 U.S.C. § 1030 (CFAA) — https://www.law.cornell.edu/uscode/text/18/1030
- *Van Buren v. United States*, 593 U.S. 374 (2021) — https://www.supremecourt.gov/opinions/20pdf/19-783_k53l.pdf
- DOJ CFAA charging policy (May 2022) — https://www.justice.gov/opa/pr/justice-department-announces-new-policy-charging-cases-under-computer-fraud-and-abuse-act
- Directive 2013/40/EU (Art. 7 + legitimate-purpose recital) — https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32013L0040
- Budapest Convention on Cybercrime (ETS 185), Art. 6 + Explanatory Report — https://www.coe.int/en/web/conventions/full-list?module=treaty-detail&treatynum=185
- StGB §§ 202a–202c — https://www.gesetze-im-internet.de/stgb/__202c.html
- BVerfG § 202c decision (2009) — https://www.bundesverfassungsgericht.de/
- Computer Misuse Act 1990 s.3A — https://www.legislation.gov.uk/ukpga/1990/18/section/3A
- CPS legal guidance, Computer Misuse Act (dual-use factors) — https://www.cps.gov.uk/legal-guidance/computer-misuse-act
- GitHub Acceptable Use Policies — https://docs.github.com/site-policy/acceptable-use-policies/github-acceptable-use-policies
- GitHub blog, June 2021 policy update — https://github.blog/2021-06-04-updates-to-our-policies-regarding-exploits-malware-and-vulnerability-research/
- EAR §§ 734.7 / 742.15(b) — https://www.bis.doc.gov/
- Google Security Blog, Chrome cookie App-Bound Encryption (2024) — https://security.googleblog.com/2024/07/improving-security-of-chrome-cookies-on.html

**Tools**
- plaso / log2timeline — https://github.com/log2timeline/plaso
- Hindsight — https://github.com/obsidianforensics/hindsight
- Impacket (`dpapi.py`) — https://github.com/fortra/impacket
- dpapick3 — https://github.com/tijldeneut/dpapick3
- SharpDPAPI / SharpChrome — https://github.com/GhostPack/SharpDPAPI
- LaZagne — https://github.com/AlessandroZ/LaZagne
- HackBrowserData — https://github.com/moonD4rk/HackBrowserData
- mimikatz — https://github.com/gentilkiwi/mimikatz
- NirSoft ChromePass — https://www.nirsoft.net/utils/chromepass.html

**Deliberately not relied on**
- Blog/Medium restatements of § 202c or s.3A — superseded by primary sources; add no enforcement data.
- "How to decrypt Chrome passwords" tutorials — no legal or policy content.
- Elcomsoft/Passware/Magnet marketing pages — used only for the observation that decryption is standard forensic functionality behind a commercial gate; not cited for any legal proposition.
- CyberUp campaign materials — advocacy; referenced only as evidence that s.3A's breadth is contested by UK practitioners, never as authority.

---

## 9. Gaps and honest limits

1. **No live verification in this run.** See §7 for the ranked check-list. Statutory *shapes* are durable; specific wording, docket numbers, tool behaviours and platform policy are not.
2. **My enforcement knowledge is not a survey.** I can say confidently what the practitioner consensus is. I am deliberately *not* asserting "this has never been prosecuted" as fact — §7 rank 4 exists for that reason.
3. **Jurisdiction of the maintainer is undetermined here.** The analysis assumes public distribution from GitHub reachable in US/EU/UK. If the maintainer is resident in a specific EU Member State, that state's Art. 7 implementation is the one that actually matters and should be read directly.
4. **Not covered:** GDPR/DPA obligations for the *examiner* processing credential data (an examiner-side, not distributor-side, question), and any jurisdiction-specific professional-licensing rules for forensic practitioners.
5. **This brief reports the landscape. It is not legal advice and should not be treated as clearance to ship.** If #124 lands on Option B or D, a short consult with counsel in the maintainer's jurisdiction is proportionate — mainly to pressure-test the UK s.3A(2) exposure, which is the only provision where careful people genuinely disagree.
