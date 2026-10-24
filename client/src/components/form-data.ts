/**
 * Form data (Chrome's `Web Data` autofill) field categories, shared by every
 * place a form value can show: the Form data page, Timeline rows for form
 * entries, and the row sheet. Payment values (and values whose field name
 * was not recorded) are secrets — hidden until a page-level "Show values"
 * Switch (or the sheet's Reveal) is on.
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
  readonly matches: (name: string) => boolean;
}

/** The `Other` bucket, and the fixed rule's guaranteed fallback. */
const OTHER_CATEGORY: FormDataCategory = {
  key: "other",
  label: "Other",
  matches: () => true,
};

export const PAYMENT_KEY = "payment";

/**
 * The Payment rule. Chrome's own names (CREDIT_CARD_NUMBER, IBAN_VALUE) and
 * the raw HTML names sites give card and bank fields (`cc-number`, `cc-exp`,
 * `cc-csc`, `ccnum`, `security_code`, `exp_date`, `pan`, `routing_number`,
 * `account-number`): a short token (`cc`, `pan`, `pin`) only counts between
 * separators. It errs towards Payment: a false hit hides a value behind a
 * Reveal, a miss shows a card number in clear.
 */
const PAYMENT_PATTERN = new RegExp(
  [
    "card",
    "credit",
    "debit",
    "cvc",
    "cvv",
    "csc",
    "wallet",
    "iban",
    "swift",
    "(?<![a-z0-9])bic(?![a-z0-9])",
    "account[_\\s-]?(?:number|num|no)",
    "acct[_\\s-]?(?:number|num|no)",
    "routing[_\\s-]?(?:number|num|no)?",
    "sort[_\\s-]?code",
    "security[_\\s-]?code",
    "(?<![a-z0-9])cc(?:[_\\s-]?(?:num|number|no|exp|expiry|month|year|csc|cvc|cvv|name|type)|(?![a-z0-9]))",
    "exp(?:iry|iration)?[_\\s-]?(?:date|month|year|mm|yy)",
    "(?<![a-z0-9])pan(?![a-z0-9])",
    "(?<![a-z0-9])pin(?![a-z0-9])",
  ].join("|"),
);

function isPaymentName(name: string): boolean {
  return PAYMENT_PATTERN.test(name);
}

export const FORM_DATA_CATEGORIES: readonly FormDataCategory[] = [
  {
    key: PAYMENT_KEY,
    label: "Payment",
    matches: isPaymentName,
  },
  {
    key: "identity",
    label: "Identity",
    matches: (name) =>
      /(?<![a-z0-9])name(?![a-z0-9])|company|first|last|middle/.test(name),
  },
  {
    key: "contact",
    label: "Contact",
    matches: (name) =>
      /email|e_mail|phone|tel(?![a-z0-9])|mobile|fax/.test(name),
  },
  {
    key: "address",
    label: "Address",
    matches: (name) =>
      /address|street|city|state|zip|postal|country|province|region/.test(name),
  },
  {
    key: "searches",
    label: "Searches",
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

/**
 * True when a Form data entry's value must be treated as a secret, from its
 * recorded `fieldName` Field: a Payment name, or no usable name at all. A
 * name that is absent, (empty), unavailable or not a string cannot rule
 * Payment out, so its value fails closed (hidden, revealable) while the
 * entry still groups under "Other".
 */
export function isSecretFormField(
  fieldName: { readonly state: string; readonly value?: unknown } | undefined,
): boolean {
  if (
    fieldName === undefined ||
    fieldName.state !== "value" ||
    typeof fieldName.value !== "string" ||
    fieldName.value.trim() === ""
  ) {
    return true;
  }
  return isPaymentField(fieldName.value);
}

/** Fields that hold a Payment entry's secret (the value and its folded copy),
 *  for `RowSheet redactedFields`. */
export const PAYMENT_SECRET_FIELDS: readonly string[] = [
  "fieldValue",
  "fieldValueLower",
];
