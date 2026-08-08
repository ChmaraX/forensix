#!/usr/bin/env python3
"""Label tools/classifier-bench/fixture/fixture_raw.json against taxonomy.json.
Labeller of record: Fable (per issue owner decision, ChmaraX/forensix#137 discussion).
Every rule below is a judgment call; rationale is recorded per row for audit."""
import json, re
from urllib.parse import urlparse

import os
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
rows = json.load(open(f"{ROOT}/tools/classifier-bench/fixture/fixture_raw.json"))

def domain(url):
    try:
        return urlparse(url).netloc.lower()
    except Exception:
        return ""

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
            return ["technology_software_dev", "anonymity_privacy_tooling"], "browsing extension store specifically for privacy/anonymity tools (Signal, ProtonMail, hide-it)", True
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

labelled = []
ambiguous_count = 0
for r in rows:
    labels, rationale, ambiguous = label(r)
    if ambiguous:
        ambiguous_count += 1
    labelled.append({
        **r,
        "labels": labels,
        "rationale": rationale,
        "ambiguous": ambiguous,
        "labeller": "fable-5 (rule-documented, owner-approved per issue #137 discussion)",
    })

out_path = f"{ROOT}/tools/classifier-bench/fixture/fixture_labelled.json"
json.dump(labelled, open(out_path, "w"), indent=2, ensure_ascii=False)

from collections import Counter
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
