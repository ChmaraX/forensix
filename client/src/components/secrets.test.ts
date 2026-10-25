import { describe, expect, it } from "vitest";

import type { FieldState, Finding } from "../types.js";
import { categoryOf, isPaymentField, isSecretFormField } from "./form-data.js";
import { secretFieldsOf } from "./secrets.js";

function row(
  findingKind: string,
  fields: Readonly<Record<string, FieldState>>,
): Finding {
  return { findingKind, fields } as unknown as Finding;
}

const named = (value: string): FieldState => ({ state: "value", value });

describe("Payment field names", () => {
  it.each([
    "CREDIT_CARD_NUMBER",
    "CREDIT_CARD_EXP_MONTH",
    "IBAN_VALUE",
    "cc-number",
    "cc-exp",
    "cc-exp-month",
    "cc-csc",
    "cc_name",
    "ccnum",
    "cc",
    "cardnumber",
    "card_holder_name",
    "cvv",
    "cvc2",
    "security_code",
    "securityCode",
    "exp_date",
    "expiry-date",
    "expiration_month",
    "pan",
    "card-pan",
    "routing_number",
    "account-number",
    "accountnumber",
    "account_number",
    "acct_no",
    "sort_code",
    "wallet_address",
    "pin",
  ])("treats %s as Payment", (name) => {
    expect(isPaymentField(name)).toBe(true);
    expect(categoryOf(name).key).toBe("payment");
  });

  it.each([
    ["NAME_FULL", "identity"],
    ["email", "contact"],
    ["ADDRESS_HOME_ZIP", "address"],
    ["search-query", "searches"],
    ["q", "searches"],
    ["company", "identity"],
    ["panel_title", "other"],
    ["accountname", "other"],
    ["export_date", "other"],
    ["spinner", "other"],
  ])("leaves %s in %s", (name, key) => {
    expect(isPaymentField(name)).toBe(false);
    expect(categoryOf(name).key).toBe(key);
  });
});

describe("secret Form data values (fail closed)", () => {
  it("is secret for a Payment name", () => {
    expect(isSecretFormField(named("cc-number"))).toBe(true);
  });

  it("is not secret for a recorded non-Payment name", () => {
    expect(isSecretFormField(named("email"))).toBe(false);
  });

  it.each<[string, FieldState | undefined]>([
    ["missing from the row", undefined],
    ["absent", { state: "absent" }],
    ["(empty)", named("")],
    ["blank", named("   ")],
    ["unavailable", { state: "unavailable", reason: "unsupported_value" }],
    ["not a string", { state: "value", value: 42 }],
  ])("is secret when the name is %s", (_label, field) => {
    expect(isSecretFormField(field)).toBe(true);
  });
});

// A cookie's value and a saved login's password are checked on screen by
// the browser E2E (e2e/dashboard-browser.test.ts).
describe("secretFieldsOf", () => {
  const PAYMENT_VALUES = ["fieldValue", "fieldValueLower"];

  it("hides a Payment form entry's value and its folded copy", () => {
    expect(
      secretFieldsOf(
        row("autofill_entry", { fieldName: named("security_code") }),
      ),
    ).toEqual(PAYMENT_VALUES);
  });

  it("hides a form entry whose name was not recorded", () => {
    expect(
      secretFieldsOf(row("autofill_entry", { fieldName: { state: "absent" } })),
    ).toEqual(PAYMENT_VALUES);
    expect(secretFieldsOf(row("autofill_entry", {}))).toEqual(PAYMENT_VALUES);
  });

  it("shows an ordinary form entry and other rows", () => {
    expect(
      secretFieldsOf(row("autofill_entry", { fieldName: named("email") })),
    ).toEqual([]);
    expect(secretFieldsOf(row("history_visit", {}))).toEqual([]);
  });
});
