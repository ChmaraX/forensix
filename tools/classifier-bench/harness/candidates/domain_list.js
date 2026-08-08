'use strict';
// Family 5 (deterministic domain list), per research/136-approach-survey.md.
//
// Contamination note: every entry below is a globally well-known brand a list-tier
// curator would include independent of this fixture (the same class of entry UT1,
// FortiGuard, Talos and Cloudflare all ship). None of the fixture's niche/long-tail
// domains (vineyardvines.com, chick-fil-a.com, aidungeon.io, wickr.com, etc.) are
// included — those were only ever seen by reading this specific fixture, and
// including them would make this "candidate" circular with how the fixture was
// labelled. Unmatched rows abstain by construction, which is also how a real
// list-tier behaves, and is the coverage number #119/#136 flagged as unmeasured.

const DOMAIN_LABELS = {
  'mail.google.com': 'webmail_messaging_voice',
  'gmail.com': 'webmail_messaging_voice',
  'mail.yahoo.com': 'webmail_messaging_voice',
  'outlook.com': 'webmail_messaging_voice',
  'mail.protonmail.com': 'webmail_messaging_voice',
  'protonmail.com': 'webmail_messaging_voice',
  'docs.google.com': 'file_sharing_cloud_storage',
  'drive.google.com': 'file_sharing_cloud_storage',
  'dropbox.com': 'file_sharing_cloud_storage',
  'facebook.com': 'social_media',
  'www.facebook.com': 'social_media',
  'twitter.com': 'social_media',
  'x.com': 'social_media',
  'instagram.com': 'social_media',
  'reddit.com': 'social_media',
  'youtube.com': 'entertainment_streaming_gaming',
  'www.youtube.com': 'entertainment_streaming_gaming',
  'netflix.com': 'entertainment_streaming_gaming',
  'spotify.com': 'entertainment_streaming_gaming',
  'twitch.tv': 'entertainment_streaming_gaming',
  'amazon.com': 'shopping_marketplace',
  'www.amazon.com': 'shopping_marketplace',
  'ebay.com': 'shopping_marketplace',
  'www.ebay.com': 'shopping_marketplace',
  'chrome.google.com': 'technology_software_dev',
  'github.com': 'technology_software_dev',
  'stackoverflow.com': 'technology_software_dev',
  'apple.com': 'technology_software_dev',
  'www.apple.com': 'technology_software_dev',
  'linkedin.com': 'employment_job_seeking',
  'indeed.com': 'employment_job_seeking',
  'coinbase.com': 'cryptocurrency_exchanges',
  'binance.com': 'cryptocurrency_exchanges',
  'bet365.com': 'gambling',
  'pokerstars.com': 'gambling',
  'pornhub.com': 'adult_sexual_content',
  'expedia.com': 'travel_transport_accommodation',
  'booking.com': 'travel_transport_accommodation',
  'airbnb.com': 'travel_transport_accommodation',
  'vrbo.com': 'travel_transport_accommodation',
  'www.vrbo.com': 'travel_transport_accommodation',
  'wikipedia.org': 'reference_education_howto',
  'en.wikipedia.org': 'reference_education_howto',
  'coursera.org': 'reference_education_howto',
  'khanacademy.org': 'reference_education_howto',
};

const AD_TRACKER_DOMAINS = new Set([
  'ad.doubleclick.net', 'doubleclick.net', 'googleadservices.com',
  'googlesyndication.com', 'clickserve.dartsearch.net', 'dartsearch.net',
]);

function domainOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function predict(row) {
  if (row.url.startsWith('chrome://') || row.url.startsWith('chrome-native://') || row.url.startsWith('chrome-extension://')) {
    return { labels: ['ads_trackers_infrastructure'], top1: 'ads_trackers_infrastructure', topScore: 1.0 };
  }
  const d = domainOf(row.url);
  if (!d) return { labels: [], top1: null, topScore: null };
  if (AD_TRACKER_DOMAINS.has(d)) {
    return { labels: ['ads_trackers_infrastructure'], top1: 'ads_trackers_infrastructure', topScore: 1.0 };
  }
  if (DOMAIN_LABELS[d]) {
    return { labels: [DOMAIN_LABELS[d]], top1: DOMAIN_LABELS[d], topScore: 1.0 };
  }
  // strip leading www. once and retry
  const stripped = d.replace(/^www\./, '');
  if (DOMAIN_LABELS[stripped]) {
    return { labels: [DOMAIN_LABELS[stripped]], top1: DOMAIN_LABELS[stripped], topScore: 1.0 };
  }
  return { labels: [], top1: null, topScore: null }; // abstain: no list entry
}

module.exports = {
  id: 'domain-list-v1',
  family: '5-deterministic-domain-list',
  requiresModel: false,
  predict,
};
