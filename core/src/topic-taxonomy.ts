/**
 * The frozen topic taxonomy — audited supervision data, kept apart from the
 * classifier algorithm that consumes it.
 *
 * The `name`, `question`, and `boundary` fields are the ONLY supervision the
 * model-backed classifier receives; they are copied verbatim from the taxonomy
 * proposal (ChmaraX/forensix#137 §3), which was written and frozen BEFORE any
 * fixture was labelled. `unclassified` is a real, mandatory member of the set:
 * a forensic classifier must be permitted to say nothing. Any change to these
 * strings must be justified against the proposal, never against measured
 * performance.
 */

export interface TopicLabel {
  readonly id: string;
  readonly name: string;
  /** The forensic question the label answers. Frozen supervision. */
  readonly question: string;
  /** The label's boundary rule. Frozen supervision. */
  readonly boundary: string;
  /** GDPR Article 9 special-category label (reported with extra care). */
  readonly specialCategory: boolean;
}

export const TOPIC_TAXONOMY: readonly TopicLabel[] = Object.freeze([
  {
    id: "search_query",
    name: "Search & Query",
    question: "What did the subject look for, in their own words?",
    boundary:
      "Applies to search-engine result pages and to in-site search endpoints.",
    specialCategory: false,
  },
  {
    id: "webmail_messaging_voice",
    name: "Webmail, Messaging & Voice",
    question: "How were they communicating off-channel?",
    boundary:
      "Web-hosted mail, chat, messaging and voice/meeting services. The label asserts the channel, never the conversation.",
    specialCategory: false,
  },
  {
    id: "social_media",
    name: "Social media & Online communities",
    question: "What accounts and what contacts?",
    boundary:
      "Social networks, forums, community platforms, professional networks, personal blogs, and dating services.",
    specialCategory: false,
  },
  {
    id: "news_current_affairs",
    name: "News & Current affairs",
    question:
      "What was the subject reading about, and when relative to the incident?",
    boundary: "Press, broadcast news, aggregators.",
    specialCategory: false,
  },
  {
    id: "reference_education_howto",
    name: "Reference, Education & How-to",
    question: "Was the subject learning or researching a method?",
    boundary:
      "Encyclopaedic and reference material, courses, academic and institutional sites, instructional material.",
    specialCategory: false,
  },
  {
    id: "entertainment_streaming_gaming",
    name: "Entertainment, Streaming & Gaming",
    question:
      "How much of this history is leisure consumption, and when did it happen?",
    boundary:
      "Video and audio streaming, music, film and TV, humour, celebrity, comics, sport as spectacle, and games.",
    specialCategory: false,
  },
  {
    id: "technology_software_dev",
    name: "Technology, Software & Developer resources",
    question: "Was the subject working, or acquiring capability?",
    boundary:
      "Vendor and product documentation, developer platforms, package and code hosting, IT, SaaS and admin consoles, AI services.",
    specialCategory: false,
  },
  {
    id: "shopping_marketplace",
    name: "Shopping & Marketplace",
    question: "What was purchased, and does it match the alleged fraud?",
    boundary:
      "Retail, auctions, classifieds, marketplaces, coupons, and property listings.",
    specialCategory: false,
  },
  {
    id: "finance_banking",
    name: "Finance & Banking",
    question:
      "Which financial institutions and accounts were accessed, and when?",
    boundary:
      "Retail and commercial banking, payments, brokerage, insurance, tax and government financial portals, accounting.",
    specialCategory: false,
  },
  {
    id: "cryptocurrency_exchanges",
    name: "Cryptocurrency & Exchanges",
    question: "Was there an exfil-monetisation or ransom-payment channel?",
    boundary:
      "Exchanges, wallets, chain explorers, mining and token services. Kept separate from Finance & Banking deliberately.",
    specialCategory: false,
  },
  {
    id: "employment_job_seeking",
    name: "Employment & Job seeking",
    question: "Was there job-seeking before the exfil?",
    boundary: "Job boards, applicant portals, recruiter services, CV tooling.",
    specialCategory: false,
  },
  {
    id: "travel_transport_accommodation",
    name: "Travel, Transport & Accommodation",
    question: "Does the browsing corroborate the movement timeline?",
    boundary:
      "Booking, carriers, accommodation, maps and routing, local transport.",
    specialCategory: false,
  },
  {
    id: "health_medical",
    name: "Health & Medical",
    question:
      "Is there a medical explanation, a capacity question, or a welfare concern?",
    boundary:
      "Conditions, symptoms, providers, appointments, pharmacy, mental-health services.",
    specialCategory: true,
  },
  {
    id: "adult_sexual_content",
    name: "Adult & Sexual content",
    question: "Was there adult material on this machine?",
    boundary:
      "Explicitly not a CSAM detector. Does not extend to dating, sex education, or non-sexual nudity.",
    specialCategory: true,
  },
  {
    id: "gambling",
    name: "Gambling",
    question: "Was there gambling activity?",
    boundary: "Betting, casino, lottery, and in-game wagering.",
    specialCategory: false,
  },
  {
    id: "file_sharing_cloud_storage",
    name: "File sharing, Cloud storage & Transfer",
    question: "How did the data leave?",
    boundary:
      "Consumer and enterprise cloud storage, document collaboration, large-file transfer, peer-to-peer, paste services.",
    specialCategory: false,
  },
  {
    id: "anonymity_privacy_tooling",
    name: "Anonymity & Privacy tooling",
    question: "Was there counter-forensic preparation?",
    boundary:
      "VPN, Tor and proxy services, encrypted-DNS services, anonymous mail, secure-delete and anti-forensic tooling.",
    specialCategory: false,
  },
  {
    id: "hacking_security_tooling",
    name: "Hacking & Security tooling",
    question: "Was there tool acquisition or capability building?",
    boundary:
      "Offensive tooling, exploit and vulnerability material, credential-attack resources, malware analysis resources.",
    specialCategory: false,
  },
  {
    id: "ads_trackers_infrastructure",
    name: "Ads, Trackers & Web infrastructure",
    question: "Which of these rows record an act by the user at all?",
    boundary:
      "Advertising and tracking beacons, CDN hosts, URL shorteners and redirect hops, parked domains, consent walls, browser-internal pages.",
    specialCategory: false,
  },
  {
    id: "unclassified",
    name: "Unclassified / insufficient signal",
    question: "Can this row support any claim?",
    boundary:
      "The row's title and URL together carry no discriminating signal. A forensic classifier must be permitted to say nothing.",
    specialCategory: false,
  },
]);

export const UNCLASSIFIED_LABEL_ID = "unclassified" as const;

/** Provenance of the frozen supervision text, recorded for auditability. */
export const TOPIC_TAXONOMY_SOURCE =
  "ChmaraX/forensix#137 section 3 (label set + forensic question + boundary rules), frozen before labelling" as const;

export const TOPIC_LABELS_BY_ID: ReadonlyMap<string, TopicLabel> = new Map(
  TOPIC_TAXONOMY.map((label) => [label.id, label]),
);
