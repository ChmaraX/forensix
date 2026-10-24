/**
 * Form data (Chrome's `Web Data` autofill) field categories, shared by every
 * place a form value can show: the Form data page, Timeline rows for form
 * entries, and the row sheet. Payment values are secrets — hidden until a
 * page-level "Show values" Switch (or the sheet's Reveal) is on.
 */

/**
 * The plain-language classes an examiner reasons in, each with the fixed
 * rule that assigns a Chrome field name to it. The rule is pattern-on-name
 * only — the field name Chrome recorded fully decides the class, so the
 * grouping is a restatement of the evidence, not a guess about the value.
 * `matches` is tried in order and the first hit wins: Payment goes first so
 * a name that also reads as an address or a name (`wallet_address`,
 * `card_holder_name`) is always treated as the secret it is; the broad
 * "Searches" and "Other" buckets sit last.
 *
 * Chrome's own autofill field names are SCREAMING_SNAKE_CASE (NAME_FULL,
 * ADDRESS_HOME_ZIP, CREDIT_CARD_NUMBER); free-text form fields the person
 * typed into keep their raw HTML `name`/`id` (search-query, q, email). Both
 * are matched case-insensitively, and a short token (`name`, `tel`, `q`)
 * only counts between separators — `_` and `-` included, which `\b` would
 * treat as part of the word (so NAME_FULL is Identity, not Other).
 */
export interface FormDataCategory {
  readonly key: string;
  readonly label: string;
  readonly hint: string;
  readonly matches: (name: string) => boolean;
}

/** The `Other` bucket, and the fixed rule's guaranteed fallback. */
const OTHER_CATEGORY: FormDataCategory = {
  key: "other",
  label: "Other",
  hint: "Everything Chrome did not label as the above",
  matches: () => true,
};

export const PAYMENT_KEY = "payment";

export const FORM_DATA_CATEGORIES: readonly FormDataCategory[] = [
  {
    key: PAYMENT_KEY,
    label: "Payment",
    hint: "Card, bank and wallet fields — hidden by default",
    matches: (name) =>
      /card|credit|cvc|cvv|wallet|iban|account_number/.test(name),
  },
  {
    key: "identity",
    label: "Identity",
    hint: "Names and who the person is",
    matches: (name) =>
      /(?<![a-z0-9])name(?![a-z0-9])|company|first|last|middle/.test(name),
  },
  {
    key: "contact",
    label: "Contact",
    hint: "E-mail and phone",
    matches: (name) =>
      /email|e_mail|phone|tel(?![a-z0-9])|mobile|fax/.test(name),
  },
  {
    key: "address",
    label: "Address",
    hint: "Postal and location fields",
    matches: (name) =>
      /address|street|city|state|zip|postal|country|province|region/.test(name),
  },
  {
    key: "searches",
    label: "Searches",
    hint: "Free text typed into search and query boxes",
    matches: (name) =>
      /search|query|(?<![a-z0-9])q(?![a-z0-9])|find|lookup|keyword/.test(name),
  },
  OTHER_CATEGORY,
];

/** The class of one Chrome field name, resolved once by the fixed rule above. */
export function categoryOf(fieldName: string | null): FormDataCategory {
  const name = (fieldName ?? "").toLowerCase();
  return (
    FORM_DATA_CATEGORIES.find((category) => category.matches(name)) ??
    OTHER_CATEGORY
  );
}

/** True when a Chrome field name is in the Payment category — its value is
 *  a secret, hidden by default. */
export function isPaymentField(fieldName: string | null): boolean {
  return categoryOf(fieldName).key === PAYMENT_KEY;
}

/** Fields that hold a Payment entry's secret (the value and its folded copy),
 *  for `RowSheet redactedFields`. */
export const PAYMENT_SECRET_FIELDS: readonly string[] = [
  "fieldValue",
  "fieldValueLower",
];
