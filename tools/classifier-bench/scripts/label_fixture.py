#!/usr/bin/env python3
"""Label tools/classifier-bench/fixture/fixture_raw.json against taxonomy.json.
Labeller of record: Fable (per issue owner decision, ChmaraX/forensix#137 discussion).
Every rule below is a judgment call; rationale is recorded per row for audit.

This script is the single source of truth for fixture_labelled.json. It must
reproduce that file byte-for-byte; harness/test/fixture.test.js and the
validator (validateFixture in harness/lib/fixture.js) both assume that.

Corrections applied after the ChmaraX/forensix#137 audit round:
  * IN-SITE SEARCH CONSISTENCY. Taxonomy label 1 (`Search & Query`) says
    "Applies to search-engine result pages AND to in-site search endpoints".
    Chrome Web Store `/webstore/search/<q>` rows are in-site search endpoints
    and previously did not carry `search_query`, while YouTube and Amazon
    in-site search did. That inconsistency injected systematic false negatives
    into every candidate that correctly detects in-site search. Fixed below.
  * PERSONA / STRATUM / eTLD+1 census fields are now emitted per row so the
    harness can report power honestly (2 personas, not 3) and cluster the
    bootstrap by registrable domain.
  * URL-LEVEL GROUPING. Dedup key remains (title, url) so the row set is
    unchanged at 208, but rows sharing a URL now carry a `url_group_id` so
    they can be excluded from independent-item counts rather than silently
    inflating per-label support.
No row was added, removed, or relabelled to improve any candidate's score.
"""
import json, re, hashlib
from urllib.parse import urlparse

import os
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
rows = json.load(open(f"{ROOT}/tools/classifier-bench/fixture/fixture_raw.json"))

def domain(url):
    try:
        return urlparse(url).netloc.lower()
    except Exception:
        return ""

# Registrable-domain (eTLD+1) approximation. Multi-part public suffixes actually
# present in this fixture are enumerated explicitly rather than guessed.
#
# This field is NOT census-only. It is the cluster unit for the domain bootstrap
# (harness/lib/metrics.js bootstrapMacroF1), the support unit for the declared
# power floor (goldDomainSupport, >=3 distinct eTLD+1), and the group key for
# leave-one-domain-out sensitivity. A wrong value therefore moves published
# confidence intervals, so it is tested (harness/test/fixture.test.js).
#
# AUDIT FIX: the browser-internal guard was `host.startswith("chrome")`, which
# also matched the REAL host `chrome.google.com` (21 rows) and returned it as its
# own registrable domain. That understated concentration (google.com read as 100
# rows / 48.1% instead of 121 rows / 58.2%) and resampled 21 google.com rows as an
# independent bootstrap cluster. Browser-internal URLs (`chrome://`,
# `chrome-extension://`) have an EMPTY netloc, so the scheme is the correct
# discriminator, not a host prefix.
MULTI_PART_SUFFIXES = ("co.uk", "org.uk", "ac.uk", "com.au", "co.nz", "co.jp")
INTERNAL_SCHEMES = ("chrome", "chrome-extension", "chrome-native", "about", "edge", "devtools")

def etld1(url):
    try:
        scheme = urlparse(url).scheme.lower()
    except Exception:
        scheme = ""
    host = domain(url)
    # Browser-internal surfaces are not web origins and have no registrable
    # domain. Key them by scheme so they still cluster together.
    if scheme in INTERNAL_SCHEMES:
        return f"{scheme}://" if not host else f"{scheme}://{host}"
    if not host:
        return host
    host = host.split(":")[0]
    parts = host.split(".")
    if len(parts) < 3:
        return host
    if ".".join(parts[-2:]) in MULTI_PART_SUFFIXES:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])

# Persona census. CONFIRMED from research/_raw/137-chromebook-recon.md:400
# ("Same staged persona as the 2021 Takeout: Eli Flatt") and
# research/_raw/137-takeout-recon.md:158,358. The 2021 Chromebook and 2021
# Takeout packages are ONE persona, so this fixture has TWO personas, not three.
PERSONA_BY_SOURCE = {
    "digitalcorpora:magnet-2021-chromebook": "eli-flatt",
    "digitalcorpora:magnet-2021-takeout": "eli-flatt",
    "digitalcorpora:magnet-2022-takeout": "rafael-shell",
}

# research/_raw/137-takeout-recon.md:485-491 verdicts the 2022 package a
# "niche/skewed stratum ... Do not use as primary source". Marked so scoring
# can report it, rather than leaving those 30 rows indistinguishable.
STRATUM_BY_SOURCE = {
    "digitalcorpora:magnet-2021-chromebook": "primary",
    "digitalcorpora:magnet-2021-takeout": "primary",
    "digitalcorpora:magnet-2022-takeout": "niche-skewed",
}

# In-site search endpoints, declared as patterns so the rule is auditable and
# the validator can assert consistency against exactly this list.
IN_SITE_SEARCH_PATTERNS = (
    "chrome.google.com/webstore/search/",
    "youtube.com/results?search_query",
    "amazon.com/s?",
    "amazon.com/s/ref",
)

def is_in_site_search(url):
    u = url.lower()
    return any(p in u for p in IN_SITE_SEARCH_PATTERNS)

def label(row):
    t = row["title"]
    u = row["url"]
    d = domain(u)
    tl = t.lower()

    # --- Browser-internal / no-content surfaces (taxonomy label 19 boundary rule) ---
    if u.startswith("chrome://") or u.startswith("chrome-native://") or u.startswith("chrome-extension://"):
        return ["ads_trackers_infrastructure"], "browser-internal surface (chrome://, chrome-extension://) per label-19 boundary rule", False

    # --- Empty title: check URL alone for signal before defaulting to Unclassified ---
    if not t.strip():
        if "aidungeon.io" in d:
            return ["entertainment_streaming_gaming"], "empty title, but URL (aidungeon.io/verify) carries discriminating signal alone", True
        return ["unclassified"], "title and URL together carry no discriminating signal", False

    # --- Webmail / messaging ---
    if "mail.google.com" in d or (d == "gmail.com") or ("accounts.google.com" in d and "mail" in u) or (d == "www.google.com" and "/gmail/" in u):
        return ["webmail_messaging_voice"], "Gmail inbox/login flow", False
    if "protonmail.com" in d:
        return ["webmail_messaging_voice"], "ProtonMail inbox/login", False

    # --- Google Docs/Sheets: cloud document collaboration ---
    if "docs.google.com" in d:
        return ["file_sharing_cloud_storage"], "Google Docs/Sheets = cloud document collaboration (label-16 boundary rule)", False
    if "sheets/about" in u:
        return ["technology_software_dev"], "Google Sheets marketing/product page, not a document itself", False

    # --- Chrome Web Store / extensions / dev tooling ---
    if "chrome.google.com/webstore" in u or "mybrowseraddon.com" in d or "darkreader.org" in d:
        if "search/hide" in u or "search/signal" in u or "search/proton" in u:
            # In-site search endpoint: taxonomy label 1 applies to in-site search
            # as well as search-engine result pages. `search_query` is therefore
            # required here, exactly as it is for YouTube and Amazon in-site search.
            return ["search_query", "technology_software_dev", "anonymity_privacy_tooling"], "in-site search on the extension store, for privacy/anonymity tools (Signal, ProtonMail, hide-it)", True
        return ["technology_software_dev"], "Chrome Web Store browsing / extension install", False
    if d in ("chrome.google.com",) and not t.strip():
        return ["unclassified"], "bare chrome.google.com host, no readable token", False
    if "chromebook/perks" in u or "chrome/devices/goodies" in u or "chromebook/offers" in u:
        return ["technology_software_dev"], "Chromebook device marketing/perks page", False

    # --- Social media ---
    if "facebook.com" in d:
        return ["social_media"], "Facebook", False
    if "twitter.com" in d:
        return ["social_media"], "Twitter account action", False

    # --- Wickr = encrypted/anonymous messaging, closer to privacy tooling than ordinary webmail ---
    if "wickr.com" in d or "wickr-customer-security" in tl.replace(" ", "-"):
        return ["anonymity_privacy_tooling"], "Wickr = encrypted/ephemeral messaging; security-research framing", False
    if "how secure is wickr" in tl:
        return ["search_query", "anonymity_privacy_tooling"], "search query about a privacy-tool's security properties", False

    # --- Vermont COVID travel restrictions: genuinely ambiguous Health vs Travel ---
    if "healthvermont.gov" in d or ("covid" in tl and "travel" in tl) or "essential travel" in tl or "esstential travel" in tl or "fullfact.org" in d:
        labels = ["travel_transport_accommodation", "health_medical"]
        if "search" in d or "google.com/search" in u:
            labels = ["search_query"] + labels
        return labels, "COVID-era travel-restriction research: genuinely both a movement-timeline question and a public-health question", True

    # --- Maps / directions / vacation rentals ---
    if "google.com/maps" in u:
        if "search?q=maps" in u or (tl == "maps - google search"):
            return ["search_query", "travel_transport_accommodation"], "maps search query", False
        return ["travel_transport_accommodation"], "maps/directions to a physical location", False
    if "vrbo.com" in d:
        return ["travel_transport_accommodation"], "vacation rental booking site", False

    # --- Chick-fil-A: split by page role ---
    if "chick-fil-a.com" in d or "login.my.chick-fil-a.com" in d:
        return ["shopping_marketplace"], "restaurant brand site / ordering account access", False
    if "google search" in tl and ("chick fil a" in tl or "recipes" in tl or "receipes" in tl or "nuggets" in tl):
        return ["search_query", "reference_education_howto"], "recipe/brand search query", False
    if re.search(r"copycat|recipes?\.?\s*$|nuggets|honey mustard", tl) or "damndelicious.net" in d or "tastesbetterfromscratch.com" in d or "gimmedelicious.com" in d:
        return ["reference_education_howto"], "recipe / cooking how-to content", False
    if "chick fil a" in tl and "google search" in tl:
        return ["search_query", "shopping_marketplace"], "brand-name search query", False

    # --- Vineyard Vines: shopping vs ad-click vs finance query ---
    if "googleadservices.com" in d or "clickserve.dartsearch.net" in d or "ad.doubleclick.net" in d:
        return ["ads_trackers_infrastructure", "shopping_marketplace"], "ad-click redirect chain landing on a shopping destination", True
    if "vineyardvines.com" in d:
        return ["shopping_marketplace"], "apparel retailer product/shop pages", False
    if "vineyard vines stock" in tl:
        return ["search_query", "finance_banking"], "stock-price query on a retail brand", False
    if "vineyard vines" in tl and "search" in tl:
        return ["search_query", "shopping_marketplace"], "brand-name search query", False

    # --- Lacrosse: sport as spectacle (Entertainment) vs sport journalism (News) vs shopping ---
    if "goterriers.com" in d:
        return ["entertainment_streaming_gaming"], "university sports team page (sport as spectacle)", False
    if "timesunion.com" in d or "yaledailynews.com" in d or "uslaxmagazine.com" in d:
        return ["news_current_affairs"], "sports journalism / news article", False
    if "youtube.com" in d:
        if "results?search_query" in u:
            return ["search_query", "entertainment_streaming_gaming"], "in-site search on a streaming platform", False
        if d == "youtube.com" and (tl == "youtube"):
            return ["entertainment_streaming_gaming"], "streaming platform homepage", False
        return ["entertainment_streaming_gaming"], "video content (streaming)", False
    if "amazon.com" in d:
        if "lacrosse" in tl and ("search" in u.lower() or "field-keywords" in u or "/s?" in u or "/s/ref" in u):
            return ["search_query", "shopping_marketplace"], "in-site product search", False
        if d == "www.amazon.com" and tl.startswith("amazon.com: online shopping"):
            return ["shopping_marketplace"], "marketplace homepage", False
        return ["shopping_marketplace"], "marketplace product page", False
    if re.search(r"lacrosse( news)? - google search", tl):
        return ["search_query", "entertainment_streaming_gaming"], "sport-as-spectacle search query", False

    # --- Chromebook/Linux/Crosh technical research ---
    if re.search(r"(linux|chromebook|crosh|command( command)? line)", tl) and "google search" in tl:
        return ["search_query", "technology_software_dev"], "technical/OS how-to search query", False
    if any(x in d for x in ("educba.com", "zdnet.com", "techjunkie.com", "makeuseof.com")):
        return ["reference_education_howto", "technology_software_dev"], "technical how-to / explainer article", False

    # --- iPhone / Apple / eBay / Android ---
    if "ebay.com" in d:
        return ["shopping_marketplace"], "marketplace listing/search", False
    if "apple.com/shop/buy-iphone" in u:
        return ["shopping_marketplace"], "purchase flow", False
    if d == "www.apple.com":
        return ["technology_software_dev"], "product info/marketing page, not a purchase flow", False
    if ("iphones for sale" in tl or "used iphones" in tl) and "search" in tl:
        return ["search_query", "shopping_marketplace"], "product-purchase search query", False
    if "androids suck" in tl.lower() or "why do androids suck" in tl:
        if "search" in tl:
            return ["search_query", "entertainment_streaming_gaming"], "opinion/humor search query", False
        return ["entertainment_streaming_gaming"], "humor/opinion blog post (label-6 boundary: humour)", False

    # --- Google homepage bare, no query ---
    if d == "www.google.com" and tl.strip() == "google":
        return ["unclassified"], "bare search-engine homepage, no query token present", False

    # --- Generic Google Search fallback: query subject not otherwise matched ---
    if "google.com/search" in u or "google.com/amp/s/" in u:
        if "larp" in tl:
            return ["search_query", "entertainment_streaming_gaming"], "hobby (LARP) search query", False
        if "magic tricks" in tl:
            return ["search_query", "reference_education_howto"], "how-to hobby search query", False
        if "minecraft" in tl:
            return ["search_query", "entertainment_streaming_gaming"], "game-asset search query", False
        if "ai dungeon" in tl:
            return ["search_query", "entertainment_streaming_gaming"], "game-platform search query", False
        return ["search_query"], "generic search query, no clearer secondary topic", False

    # --- LARP / hobby craft / magic tricks (destination pages) ---
    if "instructables.com" in d:
        return ["reference_education_howto", "entertainment_streaming_gaming"], "hobby-craft how-to article", False
    if "vanishingincmagic.com" in d:
        return ["reference_education_howto", "entertainment_streaming_gaming"], "how-to magic-trick article", False

    # --- AI Dungeon / Latitude / Spotify (gaming & streaming platforms) ---
    if "aidungeon.io" in d or "latitude.io" in d:
        return ["entertainment_streaming_gaming"], "AI Dungeon text-adventure game platform and its account provider (Latitude)", False
    if "spotify.com" in d:
        return ["entertainment_streaming_gaming"], "music streaming account page", False

    # --- Hacking tutorials ---
    if "hackingtutorials.org" in d:
        return ["hacking_security_tooling"], "exploit/CVE tutorial site", False

    # fallback
    return ["unclassified"], "no rule matched; row and rationale need human review", True

from collections import Counter

# URL groups: rows sharing a URL are title mutations of one visit, not
# independent test items. Group id is content-addressed off the URL so it is
# stable under reordering.
url_counts = Counter(r["url"] for r in rows)

labelled = []
ambiguous_count = 0
for r in rows:
    labels, rationale, ambiguous = label(r)
    if ambiguous:
        ambiguous_count += 1
    source = r["provenance"]["source"]
    shared = url_counts[r["url"]] > 1
    labelled.append({
        **r,
        "labels": labels,
        "rationale": rationale,
        "ambiguous": ambiguous,
        "labeller": "fable-5 (rule-documented, owner-approved per issue #137 discussion)",
        "persona_id": PERSONA_BY_SOURCE[source],
        "stratum": STRATUM_BY_SOURCE[source],
        "etld1": etld1(r["url"]),
        "url_group_id": "urlg-" + hashlib.sha256(r["url"].encode()).hexdigest()[:12],
        "url_group_shared": shared,
        "in_site_search": is_in_site_search(r["url"]),
    })

out_path = f"{ROOT}/tools/classifier-bench/fixture/fixture_labelled.json"
json.dump(labelled, open(out_path, "w"), indent=2, ensure_ascii=False)

label_counts = Counter(l for r in labelled for l in r["labels"])
print(f"Total rows: {len(labelled)}")
print(f"Ambiguous (multi-plausible-label) rows flagged: {ambiguous_count}")
print("\nLabel distribution:")
for k, v in label_counts.most_common():
    print(f"  {v:4d}  {k}")
unmatched = [r for r in labelled if r["rationale"].startswith("no rule matched")]
print(f"\nFallback/unmatched rows: {len(unmatched)}")
for r in unmatched:
    print("  ", r["row_id"], "|", r["title"][:50], "|", r["url"][:60])

print("\nCensus:")
print(f"  personas: {dict(Counter(r['persona_id'] for r in labelled))}")
print(f"  strata:   {dict(Counter(r['stratum'] for r in labelled))}")
print(f"  distinct eTLD+1: {len(set(r['etld1'] for r in labelled))}")
print(f"  rows in shared-URL groups: {sum(1 for r in labelled if r['url_group_shared'])}")
print(f"  in-site-search rows: {sum(1 for r in labelled if r['in_site_search'])}")
missing = [r['row_id'] for r in labelled if r['in_site_search'] and 'search_query' not in r['labels']]
print(f"  in-site-search rows missing search_query: {len(missing)} {missing}")
