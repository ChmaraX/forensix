# VERIFICATION REPORT — ChmaraX/forensix#122

**Verifies:** `/tmp/forensix-research/122-legal-constraints-decryption.md`
**Verification run:** 2026-08-02, 14:00–14:12 UTC. All fetches performed live in this session.
**Read this alongside the brief, not instead of it.** The brief's structure is left intact; this report only records what live sources did or did not confirm.

**This is not legal advice.** It records what documents literally say.

---

## Tag scheme used here

| Verdict | Meaning |
|---|---|
| **CONFIRMED** | Fetched source says what the brief said. |
| **CORRECTED** | Substantially right, but a material detail is wrong or incomplete. Correction given. |
| **REFUTED** | Fetched source contradicts the brief. |
| **STILL-UNKNOWN** | Not settled in this run. Reason stated. |

Claim types are kept strictly separate, per steering:
**(TEXT)** what a document literally says · **(ENF)** what has actually been enforced · **(CONS)** what practitioners believe · **(CODE)** what source code actually does.

---

## 0. Headline: three findings that change #124

1. **Hindsight decrypts saved Chrome passwords, is NOT gated on Windows, uses live current-user key material, and states no legal or ethical rationale anywhere.** The brief's peer-precedent table is wrong about the shape of the forensic-side precedent. → §1
2. **Chrome App-Bound Encryption now covers saved passwords, not just cookies, in current Chromium source.** The brief left this open. It is closed, and it cuts against the value of the feature on modern Windows profiles. → §5
3. **The BVerfG "narrowing construction" is real and verbatim as described — but it sits in a chamber non-acceptance decision that held the complaints inadmissible.** It is weaker authority than "the BVerfG held". → §4

---

## 1. RANK 1a — Hindsight's actual behaviour and rationale

**Verdict: CORRECTED — and it partially REFUTES the brief's §3 framing.**

**Source fetched:** `https://github.com/obsidianforensics/hindsight`, cloned in full at HEAD
`0aa808fa21de4d4a50162a42d53217691eae4189` (2026-07-17), plus GitHub contents API for tree listing.

### 1.1 Does it decrypt? YES — cookies *and* saved passwords

`(CODE)` `pyhindsight/browsers/chrome.py:840` defines `decrypt_cookie(self, encrypted_value)`.

`(CODE)` `pyhindsight/browsers/chrome.py:1061-1067` — saved passwords from `Login Data`:

```python
if row.get('password_value') is not None and self.available_decrypts['windows'] == 1:
    try:
        # Windows is all I've had time to test; Ubuntu uses built-in password manager
        password = win32crypt.CryptUnprotectData(
            row.get('password_value').decode(), None, None, None, 0)[1]
    except:
        password = self.decrypt_cookie(row.get('password_value'))
```

The result is emitted as a report row with `row_type = 'login (password)'`.

> **Brief said:** "Unknown — must check", prior confidence **Low**.
> **Correction:** it decrypts, and it decrypts passwords, not only cookies.

### 1.2 Is it gated? PARTIALLY — and **not at all on Windows**

`(CODE)` `pyhindsight/analysis.py:521-527` — Windows decryption enables itself purely on import success, with no user action:

```python
# Try to import modules for cookie decryption on different OSes.
# Windows
try:
    import win32crypt
    self.available_decrypts['windows'] = 1
except ImportError:
    self.available_decrypts['windows'] = 0
```

`(CODE)` `hindsight.py:88-92` — the CLI flag cannot even *reach* Windows:

```python
parser.add_argument('-d', '--decrypt', choices=['mac', 'linux'], default=None,
                    help='Try to decrypt Chrome data from a Linux or Mac system; support for both is currently '
                         'buggy and enabling this may cause problems. Only use "--decrypt linux" on data from a '
                         'Linux system, and only use "--decrypt mac" when running Hindsight on the same Mac the '
                         'Chrome data is from.')
```

`(CODE)` `hindsight.py:118-128` confirms the flag only ever *disables* mac/linux; Windows is never consulted.

**So:** on Windows, with `pywin32` installed, Hindsight decrypts saved passwords by default, with no flag, no prompt, and no redaction.

### 1.3 What key material? **Live, current-user — NOT operator-supplied**

`(CODE)` The Windows call is `win32crypt.CryptUnprotectData(blob, None, None, None, 0)` — no masterkey file, no SID, no password argument. It decrypts only in the DPAPI context of the *currently logged-in user running Hindsight*.

`(CODE)` macOS, `chrome.py:878-881`: `keyring.get_password('Chrome Safe Storage', 'Chrome')` — reads the live login keychain.

`(CODE)` Linux, `chrome.py:893-895`: hardcoded `my_pass = 'peanuts'`, `iterations = 1`.

> **This is the important correction.** The brief's §3 and §6 assert a clean split: forensic tools either decline on scope grounds, or "decrypt **offline with operator-supplied key material**" (Impacket, dpapick). Hindsight — the closest peer — is a **fourth category the brief does not have**: a forensic tool that decrypts using live host key material, ungated on its primary platform.
> The claim *"the forensic side either declines on scope grounds, or decrypts offline with operator-supplied key material, or gates behind commerce"* is **REFUTED as a complete taxonomy.**

### 1.4 Stated rationale: **stability, not law or ethics**

`(TEXT)` The only rationale attached to any gating is in the `--decrypt` help string quoted above: *"support for both is currently buggy and enabling this may cause problems."* That is an engineering caveat.

`(TEXT)` **No legal or ethical rationale exists anywhere in the repo.** Verified by inspection:
- `README.md` is **61 lines**. Its only headings are `## Manual Installation`, `## Command Line`, `## Default Profile Paths`, `## Feature Requests`. There is no disclaimer, no intended-use statement, no lawful-authority language, no responsible-use section.
- The capability is advertised plainly at `README.md:6`: *"...bookmarks, autofill records, **saved passwords**, preferences, browser extensions, HTTP cookies..."*
- `SECURITY.md` is a conventional vulnerability-disclosure policy (report via GitHub Security tab, or `ryan@hindsig.ht`). It says nothing about dual use.
- Grep for `legal|ethic|authoriz|authoris|consent|warrant|lawful` across `README.md` returned no matching content beyond the capability list.
- No `USAGE_POLICY.md`, `CODE_OF_CONDUCT.md` or equivalent exists at repo root.
- Licence: **Apache License 2.0** (`LICENSE.md`).

> **Brief said:** "Any explicit legal rationale from Benson is the highest-value quote available for #124."
> **Result: there is none.** That absence is itself the finding. The closest peer project ships this capability with zero legal framing and has done so publicly for years.

### 1.5 Bonus finding: Hindsight does **not** support App-Bound Encryption

`(CODE)` Grep across all `*.py` for `v20|app.bound|app_bound|elevation|AppBound` returned **zero matches**. Hindsight cannot read `v20` blobs. See §5 — this materially limits what it recovers from current Windows Chrome profiles.

---

## 2. RANK 1b — CPS dual-use factors

**Verdict: CONFIRMED, with the exact list now captured, plus two small corrections.**

**Source fetched:** `https://www.cps.gov.uk/legal-guidance/computer-misuse-act` (page states: *updated: 05 February 2020; 03 August 2023*).

`(TEXT)` Verbatim, under *Section 3A: Making, supplying or obtaining articles for use in offence under Section 1, 3 or 3ZA*:

> "The rationale behind the creation of this offence is the market in electronic malware or 'hacker tools'; which can be used for breaking into, or compromising, computer systems."

> "Section 3A(2) of the CMA covers the supplying or offering to supply an article 'likely' to be used to commit, or assist in the commission of an offence, contrary to Sections 1 or 3. **'Likely' is not defined in the CMA but, in construing what is 'likely', prosecutors should look at the functionality of the article and at what, if any, thought the suspect gave to who would use it. For example, whether the article was circulated to a closed and vetted list of IT security professionals or was posted openly.** In the offence under Section 3A(2), **the relevant mens rea is 'belief' and mere suspicion is not enough.**"

`(TEXT)` **The five enumerated factors, verbatim and complete:**

> In determining the likelihood of an article being used (or misused) to commit a criminal offence, prosecutors should consider the following:
> - Has the article been developed primarily, deliberately and for the sole purpose of committing a CMA offence (i.e. unauthorised access to computer material)?
> - Is the article available on a wide scale commercial basis and sold through legitimate channels?
> - Is the article widely used for legitimate purposes?
> - Does it have a substantial installation base?
> - What was the context in which the article was used to commit the offence compared with its original intended purpose?

**Correction 1.** The brief listed *"in what context was it made available (open professional distribution vs. closed criminal forum)"* as one of the enumerated factors. It is **not** a listed factor — it appears in the preamble, as an illustration of *"what thought the suspect gave to who would use it."* The fifth listed factor is about the context in which the article was **used to commit the offence**, which is a different thing and is not within a publisher's control. Minor, but the brief's §7 promised to "convert it verbatim into a design checklist", so the distinction matters.

**Correction 2 (immaterial, but noted for accuracy of quotation).** The CPS page states *"section 8 of the **Fraud Act 2007**"*. There is no Fraud Act 2007; the definition of "article" is in the Fraud Act **2006**. This is an error in CPS's own text. Quote it as-is if quoting.

**Also captured** `(TEXT)` — the separate *Public Interest* list (financial/reputational/commercial damage to victims; main purpose of financial gain; level of sophistication used to conceal identity; vulnerable victim; mental health, maturity and chronological age of defendant). Note these are **offender-facing** factors for a prosecution; none of them is a publisher-facing safe harbour. The brief's §7 conflated "dual-use factors" and "public-interest factors" into one item — they are two distinct lists in the source.

### Design checklist actually supported by the source

Of the five factors, ForensiX controls or can evidence four:

| CPS factor | ForensiX lever |
|---|---|
| developed primarily/deliberately/**sole purpose** of a CMA offence? | No. Forensic examination framing; offline artifact input; capability shaping. |
| wide-scale commercial basis / legitimate channels? | Public repo, packaged distribution, real maintainer identity. |
| widely used for legitimate purposes? | DFIR user base; document it. |
| substantial installation base? | Release/download counts; packaging. |
| context of *use* vs intended purpose | Not controllable — but an explicit intended-use statement makes the comparison possible at all. |

Plus, from the preamble rather than the list: **"what thought the suspect gave to who would use it"** — this is the single most actionable sentence in the document, and it is what an intended-use statement, a `--authority` assertion and a documented feature-refusal policy actually speak to.

---

## 3. RANK 2a — CMA 1990 s.3A consolidated text

**Verdict: CONFIRMED. The Serious Crime Act 2015 did NOT narrow the "believing it is likely" limb.**

**Source fetched:** `https://www.legislation.gov.uk/ukpga/1990/18/section/3A`

`(TEXT)` Current consolidated text, verbatim:

> **(1)** A person is guilty of an offence if he makes, adapts, supplies or offers to supply any article intending it to be used to commit, or to assist in the commission of, an offence under section 1, 3 or 3ZA.
> **(2)** A person is guilty of an offence if he supplies or offers to supply any article **believing that it is likely to be used** to commit, or to assist in the commission of, an offence under section 1, 3 or 3ZA.
> **(3)** A person is guilty of an offence if he obtains any article— (a) intending to use it to commit, or to assist in the commission of, an offence under section 1, 3 or 3ZA, or (b) with a view to its being supplied for use to commit, or to assist in the commission of, an offence under section 1, 3 or 3ZA.
> **(4)** In this section "article" includes any program or data held in electronic form.
> **(5)** [penalties — max 2 years on indictment]

`(TEXT)` **What SCA 2015 actually did**, from the Textual Amendments notes on the same page:
- F2: words in the **heading** substituted (3.5.2015) by SCA 2015 s. 88(1), Sch. 4 para. 8
- F3: words in **s. 3A(1)** substituted (3.5.2015) by SCA 2015 ss. 41(3), 88(1)
- **F4: words in s. 3A(2) substituted (3.5.2015) by SCA 2015 ss. 41(3), 88(1)**
- F5: words in s. 3A(3) substituted (3.5.2015) by SCA 2015 s. 42
- F7/F8: penalty wording in s. 3A(5)(b)

All of F2–F5 are the **cross-reference substitutions** inserting the then-new s.3ZA into the list "section 1, 3 or 3ZA". The mental element wording "**believing that it is likely to be used**" is untouched and stands today.

`(TEXT)` **s.3A was inserted** (1.10.2007 for Scotland, 1.10.2008 otherwise) by **Police and Justice Act 2006 (c. 48), ss. 37, 53** (with s. 38(5)(6)); S.S.I. 2007/434 art. 2; S.I. 2008/2503 art. 2(a). Brief's attribution to PJA 2006 confirmed.

`(TEXT)` **There is no legitimate-purpose, public-interest or security-research defence anywhere in s.3A(1)–(5).** Confirmed by reading the full section. The brief's strongest legal point stands **CONFIRMED**.

---

## 4. RANK 2b — BVerfG on § 202c, and the German statutes

### 4.1 The decision — CONFIRMED, dockets correct, but authority weaker than the brief implies

**Source fetched:** `https://www.bundesverfassungsgericht.de/SharedDocs/Entscheidungen/DE/2009/05/rk20090518_2bvr223307.html`

`(TEXT)` **Dockets — all three confirmed exactly as the brief guessed:** **2 BvR 2233/07**, **2 BvR 1151/08**, **2 BvR 1524/08**, joined.

`(TEXT)` **Beschluss vom 18. Mai 2009**, by *die 2. Kammer des Zweiten Senats*, judges **Broß, Di Fabio and Landau**, decided **einstimmig** (unanimously) under §§ 93b i.V.m. 93a BVerfGG. Associated press release: **Nr. 67/2009 vom 19. Juni 2009**.

`(TEXT)` **Disposition, verbatim:** *"Die Verfahren werden zur gemeinsamen Entscheidung verbunden. Die Verfassungsbeschwerden werden nicht zur Entscheidung angenommen."*

`(TEXT)` And the ground, verbatim: *"Die Annahmevoraussetzungen des § 93a Abs. 2 BVerfGG sind nicht erfüllt. ... Die Verfassungsbeschwerden sind mangels unmittelbarer Betroffenheit der Beschwerdeführer ... "*

> **Refinement to the brief.** The brief calls this "**the load-bearing authority** for the 'dual-use is fine in Germany' position." It is a **Kammer** (three-judge chamber) **Nichtannahmebeschluss** that declined the complaints as inadmissible for lack of direct effect. The narrowing construction below is reasoning offered en route to non-acceptance, **not a Senate holding on constitutionality**. Directionally strong and routinely relied on, but it should be cited as *"the Second Chamber of the Second Senate, in declining to accept the complaints, construed § 202c narrowly as follows"* — not as *"the BVerfG held."*

### 4.2 The narrowing construction — CONFIRMED verbatim

`(TEXT)` At margin nos. **60–61**:

> "**Tatobjekt des § 202c Abs. 1 Nr. 2 StGB kann nur ein Programm sein, dessen Zweck die Begehung einer Straftat nach § 202a StGB (Ausspähen von Daten) oder § 202b StGB (Abfangen von Daten) ist. Danach muss das Programm mit der Absicht entwickelt oder modifiziert worden sein, es zur Begehung der genannten Straftaten einzusetzen. Diese Absicht muss sich ferner objektiv manifestiert haben.**"

> "**Schon nach dem Wortlaut nicht ausreichend wäre, dass ein Programm - wie das für so genannte dual use tools gilt - für die Begehung der genannten Computerstraftaten lediglich geeignet oder auch besonders geeignet ist.**"

*(Working translation, non-authoritative: the object of the offence can only be a program whose **purpose** is the commission of a § 202a/§ 202b offence; the program must have been developed or modified **with the intention** of using it to commit those offences, and that intention must have **objectively manifested itself**. It would not suffice — as is the case for so-called dual use tools — that a program is merely suitable, or even particularly suitable, for committing those offences.)*

This is exactly the direction the brief described. **CONFIRMED**, and now quotable with a source.

`(TEXT)` The decision also reproduces the **Budapest Convention Explanatory Report** at its Rn. 72–73, in English, on the same point:

> "As a reasonable compromise the Convention restricts its scope to cases where the devices are objectively designed, or adapted, primarily for the purpose of committing an offence. **This alone will usually exclude dual-use devices.**"

This is a better citation for the Budapest carve-out than the brief's §2.2 reference, because it comes through a court.

### 4.3 § 202a and § 202c statutory text — CONFIRMED verbatim

**Sources fetched:** `https://www.gesetze-im-internet.de/stgb/__202a.html` and `.../__202c.html`

`(TEXT)` **§ 202a — Ausspähen von Daten:**
> "(1) Wer **unbefugt** sich oder einem anderen Zugang zu Daten, die **nicht für ihn bestimmt** und die gegen unberechtigten Zugang **besonders gesichert** sind, **unter Überwindung der Zugangssicherung** verschafft, wird mit Freiheitsstrafe bis zu drei Jahren oder mit Geldstrafe bestraft."

All three cumulative elements the brief relied on are confirmed.

`(TEXT)` **§ 202c — Vorbereiten des Ausspähens und Abfangens von Daten:**
> "(1) Wer eine Straftat nach § 202a oder § 202b vorbereitet, indem er
> 1. Passwörter oder sonstige Sicherungscodes, die den Zugang zu Daten (§ 202a Abs. 2) ermöglichen, oder
> 2. **Computerprogramme, deren Zweck die Begehung einer solchen Tat ist**,
> herstellt, sich oder einem anderen verschafft, verkauft, einem anderen überlässt, verbreitet oder sonst zugänglich macht, wird mit Freiheitsstrafe bis zu zwei Jahren oder mit Geldstrafe bestraft.
> (2) § 149 Abs. 2 und 3 gilt entsprechend."

CONFIRMED. Note the § 149(2)–(3) cross-reference gives a **tätige Reue** (active repentance) route, which the brief did not mention.

---

## 5. RANK 2c — Chrome App-Bound Encryption: does it now cover passwords?

**Verdict: CORRECTED — YES, on current Chromium source. This is the largest factual change to the brief's cost/benefit analysis.**

### 5.1 What Google announced (2024) — cookies first, passwords "in future"

**Source fetched:** `https://security.googleblog.com/2024/07/improving-security-of-chrome-cookies-on.html` (Will Harris, Chrome Security Team, **July 30, 2024**).

`(TEXT)` Verbatim:
> "In **Chrome 127** we are introducing a new protection on Windows that improves on the DPAPI by providing **Application-Bound (App-Bound) Encryption** primitives."
> "We will be migrating each type of secret to this new system **starting with cookies in Chrome 127**. **In future releases we intend to expand this protection to passwords, payment data, and other persistent authentication tokens**, further protecting users from infostealer malware."
> "Because the App-Bound service is running with **system privileges**, attackers need to do more than just coax a user into running a malicious app. Now, the malware has to gain system privileges, or inject code into Chrome..."

So as at that post, passwords were **not** covered. The brief's account of the 2024 position is CONFIRMED.

### 5.2 What current Chromium source shows — passwords ARE now on the ABE path

`(CODE)` **Source fetched:** `https://raw.githubusercontent.com/chromium/chromium/main/components/password_manager/core/browser/password_store/login_database_win.cc`

The Windows password store now includes `"components/os_crypt/async/common/encryptor.h"` and encrypts/decrypts through **`os_crypt_async::Encryptor`**:

```cpp
#include "components/os_crypt/async/common/encryptor.h"
...
EncryptionResult LoginDatabase::EncryptedString(
    const std::u16string& plain_text, std::string* cipher_text) const {
  bool result = encryptor_ && encryptor_->EncryptString16(plain_text, cipher_text);
  ...
```

That is the **same OSCryptAsync stack** that hosts App-Bound Encryption — not the legacy synchronous DPAPI `OSCrypt` path.

`(CODE)` **Source fetched:** `https://raw.githubusercontent.com/chromium/chromium/main/chrome/browser/os_crypt/app_bound_encryption_provider_win.h`

```cpp
inline constexpr uint8_t kCryptAppBoundKeyPrefix[] = {'A', 'P', 'P', 'B'};   // line 46
inline constexpr char kAppBoundDataPrefix[] = "v20";                          // line 50
```

Confirms the `v20` data prefix and the `APPB` key prefix stored in `Local State`.

`(CODE)` **Source fetched:** `https://raw.githubusercontent.com/chromium/chromium/main/chrome/browser/browser_process_impl.cc`, ~lines 1564–1571 — provider precedence, with the decisive comment in-tree:

```cpp
providers.emplace_back(std::make_pair(
    // Note: 15 is chosen to be higher than the 10 precedence above for
    // DPAPI. This ensures that when the provider is enabled for
    // encryption, the App-Bound encryption key is used and not the DPAPI
    // one.
    /*precedence=*/15u,
    std::make_unique<os_crypt_async::AppBoundEncryptionProviderWin>(
        local_state(), /*force_protection_level=*/std::nullopt)));
```

`(CODE)` **Source fetched:** `https://raw.githubusercontent.com/chromium/chromium/main/chrome/browser/os_crypt/app_bound_encryption_provider_win.cc`, lines 259–262 — and there is **no feature-flag off switch** on the encryption path:

```cpp
bool AppBoundEncryptionProviderWin::UseForEncryption() {
  DCHECK_CALLED_ON_VALID_SEQUENCE(sequence_checker_);
  return support_level_ == os_crypt::SupportLevel::kSupported;
}
```

**Conclusion (CODE):** on current Chromium `main`, where App-Bound Encryption is supported, the ABE key (precedence 15) beats DPAPI (precedence 10), and the password store uses that same `os_crypt_async::Encryptor`. Saved passwords on supported Windows installs are therefore written under the **`v20` / App-Bound** scheme, not user-context DPAPI.

**Scope limit on this finding — read it.** I verified **Chromium `main` source**, not the runtime behaviour of a shipped Stable build, and not which Chrome milestone made the switch. I did not find and did not fetch a Google announcement confirming the password migration shipped. A profile in the field will also contain a mix of legacy `v10`/`v11` and new `v20` records depending on when each was written. **Do not state a milestone number.**

### 5.3 Why this matters for #124

- Offline decryption of `v20` password records requires the **SYSTEM DPAPI key material** captured from the image, plus the app-bound wrapping — meaningfully harder than the `v10`/`v11` + user masterkey path the brief assumed.
- **Hindsight has no `v20` support at all** (§1.5). Neither does anything in the brief's forensic column.
- `(CODE)` The offensive side **has already adapted**: `https://github.com/moonD4rk/HackBrowserData` `crypto/version.go` defines `CipherV20 CipherVersion = "v20"` and dispatches on the `v20` prefix. So the capability gap now runs the *other* way — offensive OSS handles ABE, open forensic tooling does not.
- The legal analysis is unchanged by any of this. The **cost/benefit** is not.

---

## 6. RANK 3a — Directive 2013/40/EU

**Verdict: CONFIRMED, and the recital the brief could not cite is now pinned. It is actually two recitals.**

**Source fetched:** `https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32013L0040`

`(TEXT)` **Article 7 — Tools used for committing offences**, verbatim:
> "Member States shall take the necessary measures to ensure that the intentional production, sale, procurement for use, import, distribution or otherwise making available, of one of the following tools, **without right and with the intention that it be used to commit** any of the offences referred to in Articles 3 to 6, is punishable as a criminal offence, at least for cases which are not minor:
> (a) a computer programme, **designed or adapted primarily for the purpose of** committing any of the offences referred to in Articles 3 to 6;
> (b) a computer password, access code, or similar data by which the whole or any part of an information system is capable of being accessed."

Both limiters the brief identified — the objective *"designed or adapted primarily for"* test and the subjective intent requirement — CONFIRMED verbatim.

`(TEXT)` **Recital (16)** — the legitimate-purpose recital:
> "Even where such a tool is suitable or particularly suitable for carrying out one of the offences laid down in this Directive, it is possible that it was produced for a legitimate purpose. **Motivated by the need to avoid criminalisation where such tools are produced and put on the market for legitimate purposes, such as to test the reliability of information technology products or the security of information systems, apart from the general intent requirement, a direct intent requirement that those tools be used to commit one or more of the offences** [is laid down]..."

`(TEXT)` **Recital (17)** — the no-criminal-intent recital the brief was half-remembering:
> "This Directive **does not impose criminal liability where the objective criteria of the offences laid down in this Directive are met but the acts are committed without criminal intent**, for instance where a person does not know that access was unauthorised **or in the case of mandated testing or protection of information systems**, such as where a person is assigned by a company or vendor to test the strength of its security system."

> **Brief said:** "Recital 16 ... I am not confident quoting it verbatim or citing the recital number ... Expected: a recital in the 15–17 range."
> **Verdict: CONFIRMED and refined.** The brief described *one* recital doing two jobs. It is **two**: (16) legitimate purpose + direct intent for tools; (17) no liability absent criminal intent, mandated testing. Cite both. Note that (16) is the one that is actually about **tools**, which is the ForensiX-relevant one.

---

## 7. RANK 3b — GitHub Acceptable Use Policies

**Verdict: CONFIRMED — and the policy contains an actionable checklist the brief did not know about.**

**Source fetched:** `https://docs.github.com/en/site-policy/acceptable-use-policies/github-active-malware-or-exploits`
(the specific sub-policy; the parent AUP at `.../github-acceptable-use-policies` was also fetched)

`(POLICY)` `(TEXT)` Verbatim, the prohibition:
> "We do not allow anyone to use our platform **in direct support of unlawful attacks that cause technical harms**, such as using GitHub as a means to deliver malicious executables or as attack infrastructure, for example by organizing denial of service attacks or managing command and control servers. Technical harms means overconsumption of resources, physical damage, downtime, denial of service, or data loss, **with no implicit or explicit dual-use purpose prior to the abuse occurring**."

`(POLICY)` `(TEXT)` Verbatim, the permission:
> "Note that **GitHub allows dual-use content and supports the posting of content that is used for research into vulnerabilities, malware, or exploits**, as the publication and distribution of such content has educational value and provides a net benefit to the security community. **We assume positive intention and use of these projects** to promote and drive improvements across the ecosystem."

`(POLICY)` `(TEXT)` Verbatim, restrict-not-remove and appeals:
> "In **rare cases of very widespread abuse of dual-use content**, we may restrict access to that specific instance of the content... In most of these instances, **restriction takes the form of putting the content behind authentication**, but may, as an option of last resort, involve disabling access or full removal where this is not possible (e.g. when posted as a gist). We will also contact the project owners about restrictions put in place where possible."
> "Restrictions are **temporary where feasible**, and do not serve the purpose of purging or restricting any specific dual-use content... if you do feel your content was unduly restricted, we have an appeals process in place."

All three of the brief's §5 bullets CONFIRMED.

### 7.1 Bonus — GitHub's own recommended steps map straight onto ForensiX's design

`(POLICY)` `(TEXT)` Verbatim:
> "To facilitate a path to abuse resolution with project maintainers themselves, prior to escalation to GitHub abuse reports, we recommend, but do not require, that repository owners take the following steps when posting potentially harmful security research content:
> - **Clearly identify and describe any potentially harmful content in a disclaimer in the project's `README.md` file or source code comments.**
> - **Provide a preferred contact method for any 3rd party abuse inquiries through a `SECURITY.md` file in the repository**..."

This is a platform-published, citable basis for two safeguards the brief listed under §4 as mere convention. Cheap to satisfy; do both.

### 7.2 Bonus — npm carve-out, relevant to Option C

`(POLICY)` `(TEXT)` Verbatim:
> "**GitHub considers the npm registry to be a platform used primarily for installation and run-time use of code, and not for research.**"

`(CONS)` The dual-use research allowance is expressly narrower on npm than on github.com. If ForensiX ever publishes an npm artifact containing the decryption path, the safe harbour it enjoys on the repo does **not** travel with it. This is a concrete point in favour of **Option C** (separate module) that the brief reached by a different route.

---

## 8. RANK 6 (steering) / §5 — Are the comparator tools actually hosted on GitHub?

**Verdict: CONFIRMED empirically, via the GitHub REST API, this session.**

| Repository | HTTP | Archived | Stars | Last push |
|---|---|---|---|---|
| `AlessandroZ/LaZagne` | 200 | **false** | 10,943 | 2025-09-18 |
| `moonD4rk/HackBrowserData` | 200 | **false** | 14,377 | 2026-08-02 |
| `GhostPack/SharpDPAPI` | 200 | **false** | 1,440 | 2024-06-27 |
| `gentilkiwi/mimikatz` | 200 | **false** | 21,743 | 2026-04-17 |
| `obsidianforensics/hindsight` | 301→200 | (cloned OK) | — | 2026-07-17 |
| `fortra/impacket` | 200 | **false** | 15,960 | 2026-07-31 |
| `log2timeline/plaso` | 200 | **false** | 2,127 | 2026-08-02 |

Source: `https://api.github.com/repos/<owner>/<repo>`, fetched 2026-08-02.

`(ENF)` `(CODE)` And the capability is present, not merely alleged: `HackBrowserData` was cloned and its `crypto/version.go` defines `CipherV20`, `CipherDPAPI`, and dispatches Chrome blob versions; `crypto/crypto_windows.go` exposes `DecryptDPAPI`. So a tool doing exactly the disputed thing, cross-browser and zero-argument, with **14,377 stars**, was pushed to **on the day of this verification run** and is not archived, not restricted.

> The brief's §5 claim — *"the empirical point is stronger than the policy wording"* — **CONFIRMED.** This is the single most robust fact in the whole file: takedown risk for a documented forensic parser is negligible on the observable record.

---

## 9. RANK 7 — DOJ CFAA charging policy

**Verdict: CONFIRMED — located in the Justice Manual, and the brief's expectation about its scope is right.**

**Source fetched:** `https://www.justice.gov/jm/jm-9-48000-computer-fraud` (read via browser; the 2022 press-release URL in the brief now 404s, archived copy at `https://www.justice.gov/archives/opa/pr/justice-department-announces-new-policy-charging-cases-under-computer-fraud-and-abuse-act` returns 200 but yielded no extractable body).

`(TEXT)` Verbatim, the good-faith factor:
> "The attorney for the government **should decline prosecution** if available evidence shows the defendant's conduct consisted of, and the defendant intended, **good-faith security research**. For purposes of this policy, the attorney for the government should apply the definition of 'good-faith security research' recommended by the Register of Copyrights in *Section 1201 Rulemaking: Eighth Triennial Proceeding to Determine Exemptions to the Prohibition on Circumvention*, at 258 (Oct. 2021). That is: '**good faith security research' means accessing a computer solely for purposes of good-faith testing, investigation, and/or correction of a security flaw or vulnerability**, where such activity is carried out in a manner designed to avoid any harm to individuals or the public, and where the information derived from the activity is used primarily to promote the security or safety of the class of devices, machines, or online services to which the accessed computer belongs..."

`(TEXT)` And the *Van Buren*-aligned comment:
> "The Department will not bring 'exceeds authorized access' cases based on the theory that a defendant's authorization to access a particular file, database, folder, or user account was conditioned by a contract, agreement, or policy..."

> **Brief said:** "Expected: a good-faith research carve-out that **does not squarely cover forensic tooling**."
> **CONFIRMED.** The definition is keyed to *accessing a computer* for *testing/investigation/correction of a security flaw or vulnerability*. A forensic artifact parser is not that. The policy gives ForensiX no shelter — but note it is a **charging policy about the accessing user**, not about a distributor, and the brief already assesses US distributor risk as very low on the strength of the statute (§10 below). Directional comfort only, exactly as the brief predicted.

---

## 10. Spot-checks on §2.1 (US)

`(TEXT)` **18 U.S.C. § 1030(a)(6) — CONFIRMED verbatim.**
Source: `https://www.law.cornell.edu/uscode/text/18/1030`
> "(6) **knowingly and with intent to defraud** traffics (as defined in section 1029) **in any password or similar information** through which a computer may be accessed without authorization, if— (A) such trafficking affects interstate or foreign commerce; or (B) such computer is used by or for the Government of the United States;"

Both of the brief's two reasons hold on the face of the text: the object is a *password or similar information*, not a program; and the mens rea is *intent to defraud*. Confirmed.

`(TEXT)` **STILL-UNKNOWN — *Van Buren v. United States*, 593 U.S. 374 (2021).** The slip opinion PDF exists and downloads (212,335 bytes, valid `%PDF`) from `https://www.supremecourt.gov/opinions/20pdf/19-783_k53l.pdf`, but no PDF text extractor was available in this environment and Justia returned HTTP 403 to both plain fetch and browser. **The "gates-up-or-down" holding and the U.S. Reports pagination are NOT verbatim-verified in this run.** Do not quote the holding from the brief. Low blast radius: it protects the *examiner*, and the US analysis does not turn on it.

---

## 11. Items NOT settled

| # | Item | Verdict | Why |
|---|---|---|---|
| **4** | Enforcement record: any s.3A / § 202c prosecution of a legitimate dual-use tool publisher | **STILL-UNKNOWN** | No `web_search` tool in this environment. BAILII's search CGI (`lucy_search_1.cgi`) returned no parseable output. Case-law databases are not reachable by URL-guessing. **The brief's §7 rank 4 must stay open.** What I *can* say is the §8 empirical substitute: four such tools are hosted, unarchived, and actively maintained on GitHub today. That is evidence about platform risk, **not** about prosecution risk, and must not be presented as such. |
| **5** | UK CMA reform status | **PARTIAL** | `https://www.gov.uk/government/consultations/computer-misuse-act-1990-call-for-information` confirms `(TEXT)` the consultation "**has concluded**", ran **11 May 2021 to 8 June 2021**, and that the Home Office published *"Review of the Computer Misuse Act 1990: consultation and response to call for information."* I did **not** open the ODT/Word response document. **Negative confirmation is however solid from the statute itself:** the current consolidated s.3A on legislation.gov.uk contains **no defence provision** (§3 above), so no statutory defence has been enacted into s.3A as at the version served. CyberUp's site (`cyberup.uk`) did not resolve (curl exit 000). |
| **6a** | German § 202a/§ 202c reform draft (security-research exemption) | **STILL-UNKNOWN** | All guessed BMJ URLs returned 404; `bmj.de` legislative-index page 404s via browser too. No search tool. **Brief's instruction "Do not rely on it" stands unchanged.** |
| **6b** | Modern Solution case details | **STILL-UNKNOWN** | `heise.de/thema/Modern-Solution` 404s. heise's search *does* report 6 Newsticker hits for "Modern Solution Urteil", but the results are behind a cookie-consent wall that the QA/snapshot path could not clear without interacting with a consent dialog. Judgement call: rank 6, illustrative only, concerns **access** not **distribution** — not worth further budget. Unverified; do not cite court names, dates or outcomes from the brief. |
| **8** | EAR §§ 734.7 / 742.15(b) notification | **STILL-UNKNOWN** | Not attempted beyond the brief's own assessment. Lowest blast radius; the brief itself calls it "a five-minute action item, not a decision input." Verify at implementation time, not decision time. |
| — | Budapest Convention ETS 185 Art. 6(2) primary text | **STILL-UNKNOWN (superseded)** | `rm.coe.int` returned a 778-byte stub; `coe.int` treaty-detail page rendered navigation only. **Not needed:** the BVerfG decision (§4.2) quotes the Explanatory Report's dual-use passage in English, which is a stronger citation anyway. |
| — | *Van Buren* holding verbatim | **STILL-UNKNOWN** | See §10. |

---

## 12. Net effect on the brief's Options table

The legal analysis in the brief survives verification essentially intact. Two things move.

**1. Option B's premise is no longer supported by the peer precedent it invoked.**
The brief justifies "offline, operator-supplied key material" partly by asserting that this is what forensic tools do. Impacket and dpapick may well fit that shape (**not re-verified in this run — still `[UV]`**), but **Hindsight does not**, and Hindsight is the named closest peer. Option B remains the most defensible design on the *statutory* analysis — the Art. 7 "designed or adapted **primarily** for" test (§6) and the CPS factors (§2) both reward it — but it should now be presented as **stricter than the peer norm**, a deliberate choice, not as matching it.

**2. Option B's forensic value on modern Windows is materially lower than assumed.**
Because saved passwords now travel the ABE/`v20` path (§5), the `Local State` + user-DPAPI-masterkey recipe that Option B was designed around recovers less from current profiles. This does not change any legal conclusion. It changes the cost/benefit, and #124 should weigh it explicitly. Note also the awkward optics of the alternative: matching HackBrowserData's `v20` support means implementing the exact capability Google built ABE to stop, which is a harder story to tell than `v10` decryption ever was.

**3. Unchanged and now firmly evidenced:**
- UK s.3A(2)'s belief-about-likelihood limb survives intact with no defence (§3) — **the brief's strongest point, confirmed.**
- The CPS factors are real, and four of five are within the project's control (§2).
- The German dual-use narrowing is real and quotable, with the authority-weight caveat (§4).
- Art. 7's two limiters are real, with recitals 16 and 17 now citable (§6).
- GitHub permits dual-use content explicitly, and publishes a two-item checklist the project should just satisfy (§7).
- Comparable and far more aggressive tools are hosted, unarchived and actively maintained (§8).

**4. Unchanged caveat, restated because it is the honest bottom line:**
Nothing here is legal advice or clearance to ship. The one genuinely open legal question — UK s.3A(2) exposure — is open because the statute has no defence, and no amount of documentary verification closes it. §11 rank 4 remains unanswered: I could not establish the enforcement record either way, and **absence of a finding is not a finding of absence.**

---

## 13. Every URL actually fetched in this run

Fetched 2026-08-02, 14:00–14:12 UTC.

**Primary legal sources**
- `https://www.legislation.gov.uk/ukpga/1990/18/section/3A`
- `https://www.cps.gov.uk/legal-guidance/computer-misuse-act`
- `https://www.gesetze-im-internet.de/stgb/__202a.html`
- `https://www.gesetze-im-internet.de/stgb/__202c.html`
- `https://www.bundesverfassungsgericht.de/SharedDocs/Entscheidungen/DE/2009/05/rk20090518_2bvr223307.html`
- `https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32013L0040`
- `https://www.law.cornell.edu/uscode/text/18/1030`
- `https://www.justice.gov/jm/jm-9-48000-computer-fraud`
- `https://www.gov.uk/government/consultations/computer-misuse-act-1990-call-for-information`

**Platform policy**
- `https://docs.github.com/en/site-policy/acceptable-use-policies/github-active-malware-or-exploits`
- `https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies`

**Chrome / Chromium**
- `https://security.googleblog.com/2024/07/improving-security-of-chrome-cookies-on.html`
- `https://raw.githubusercontent.com/chromium/chromium/main/chrome/browser/os_crypt/app_bound_encryption_provider_win.h`
- `https://raw.githubusercontent.com/chromium/chromium/main/chrome/browser/os_crypt/app_bound_encryption_provider_win.cc`
- `https://raw.githubusercontent.com/chromium/chromium/main/chrome/browser/browser_process_impl.cc`
- `https://raw.githubusercontent.com/chromium/chromium/main/components/password_manager/core/browser/password_store/login_database.cc`
- `https://raw.githubusercontent.com/chromium/chromium/main/components/password_manager/core/browser/password_store/login_database_win.cc`

**Repositories (cloned or API-queried)**
- `https://github.com/obsidianforensics/hindsight` — full clone @ `0aa808fa21de4d4a50162a42d53217691eae4189`
- `https://github.com/moonD4rk/HackBrowserData` — full clone
- `https://api.github.com/repos/{AlessandroZ/LaZagne, moonD4rk/HackBrowserData, GhostPack/SharpDPAPI, gentilkiwi/mimikatz, fortra/impacket, log2timeline/plaso}`

**Fetched but unusable** (recorded so nobody repeats the attempt)
- `https://www.supremecourt.gov/opinions/20pdf/19-783_k53l.pdf` — downloads; no text extractor available
- `https://supreme.justia.com/cases/federal/us/593/19-783/` — HTTP 403 to fetch and to browser
- `https://rm.coe.int/1680081561`, `https://www.coe.int/en/web/conventions/full-list?module=treaty-detail&treatynum=185` — stub / navigation only
- `https://www.justice.gov/archives/opa/pr/justice-department-announces-new-policy-charging-cases-under-computer-fraud-and-abuse-act` — HTTP 200, no extractable body
- `https://www.bailii.org/cgi-bin/lucy_search_1.cgi?...` — no parseable results
- `https://www.heise.de/suche?q=Modern+Solution+Urteil` — 6 hits reported, blocked by consent wall
- `https://www.bmj.de/...` (several guessed paths) — 404
- `https://www.cyberup.uk/` — did not resolve

**Not re-verified in this run — still carry the brief's `[UV]` tag**
Impacket `dpapi.py` and dpapick3 behaviour; SharpDPAPI command split; plaso's Chrome parsers; NirSoft AV classification; commercial suite gating; macOS/Linux Chrome key derivation specifics; export-control notification requirements.
