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

/**
 * Chrome's own autofill field types (SCREAMING_SNAKE_CASE) as the names a
 * person uses. Only Chrome's fixed type names are mapped; any other name
 * falls through to `formFieldLabel`'s word rule.
 */
const CHROME_FIELD_NAMES: Readonly<Record<string, string>> = {
  NAME_FIRST: "First name",
  NAME_MIDDLE: "Middle name",
  NAME_MIDDLE_INITIAL: "Middle initial",
  NAME_LAST: "Last name",
  NAME_FULL: "Full name",
  NAME_SUFFIX: "Name suffix",
  NAME_HONORIFIC_PREFIX: "Title",
  EMAIL_ADDRESS: "Email address",
  USERNAME: "Username",
  COMPANY_NAME: "Company",
  PHONE_HOME_NUMBER: "Phone number",
  PHONE_HOME_CITY_CODE: "Area code",
  PHONE_HOME_COUNTRY_CODE: "Phone country code",
  PHONE_HOME_CITY_AND_NUMBER: "Phone number with area code",
  PHONE_HOME_WHOLE_NUMBER: "Phone number",
  PHONE_HOME_EXTENSION: "Phone extension",
  ADDRESS_HOME_LINE1: "Address line 1",
  ADDRESS_HOME_LINE2: "Address line 2",
  ADDRESS_HOME_LINE3: "Address line 3",
  ADDRESS_HOME_APT_NUM: "Apartment number",
  ADDRESS_HOME_STREET_ADDRESS: "Street address",
  ADDRESS_HOME_CITY: "City",
  ADDRESS_HOME_STATE: "State",
  ADDRESS_HOME_ZIP: "Postal code",
  ADDRESS_HOME_COUNTRY: "Country",
  ADDRESS_HOME_DEPENDENT_LOCALITY: "Locality",
  ADDRESS_HOME_SORTING_CODE: "Sorting code",
  CREDIT_CARD_NAME_FULL: "Name on card",
  CREDIT_CARD_NAME_FIRST: "First name on card",
  CREDIT_CARD_NAME_LAST: "Last name on card",
  CREDIT_CARD_NUMBER: "Card number",
  CREDIT_CARD_EXP_MONTH: "Card expiry month",
  CREDIT_CARD_EXP_2_DIGIT_YEAR: "Card expiry year",
  CREDIT_CARD_EXP_4_DIGIT_YEAR: "Card expiry year",
  CREDIT_CARD_EXP_DATE_2_DIGIT_YEAR: "Card expiry date",
  CREDIT_CARD_EXP_DATE_4_DIGIT_YEAR: "Card expiry date",
  CREDIT_CARD_TYPE: "Card type",
  CREDIT_CARD_VERIFICATION_CODE: "Card security code",
  IBAN_VALUE: "IBAN",
};

/**
 * A recorded form field name as a label, the one rule for every place a
 * form entry is named (the Form data table and sheet title, the Timeline,
 * the Sites drill-down): Chrome's own type names read as people say them
 * ("NAME_FULL" → "Full name"); any other name - a site's raw HTML
 * `name`/`id` - has its separators and camelCase turned into spaces and its
 * first letter capitalized ("search-query" → "Search query",
 * "wallet_address" → "Wallet address"). A label, never a claim: the exact
 * recorded name stays byte for byte in the row sheet. Null for no name.
 */
export function formFieldLabel(fieldName: string | null): string | null {
  if (fieldName === null || fieldName.trim() === "") {
    return null;
  }
  const known = CHROME_FIELD_NAMES[fieldName];
  if (known !== undefined) {
    return known;
  }
  const words = fieldName
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_\-.]+/)
    .filter(Boolean)
    .map((word) =>
      /^[A-Z0-9]+$/.test(word) && word.length > 3 ? word.toLowerCase() : word,
    );
  if (words.length === 0) {
    return fieldName;
  }
  const sentence = words
    .map((word, index) => (index === 0 ? word : word.toLowerCase()))
    .join(" ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}
