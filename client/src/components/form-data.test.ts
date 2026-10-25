import { describe, expect, it } from "vitest";

import { formFieldLabel } from "./form-data.js";

describe("formFieldLabel", () => {
  it.each([
    ["NAME_FULL", "Full name"],
    ["PHONE_HOME_WHOLE_NUMBER", "Phone number"],
    ["ADDRESS_HOME_ZIP", "Postal code"],
    ["CREDIT_CARD_NAME_FULL", "Name on card"],
    ["EMAIL_ADDRESS", "Email address"],
  ])("names Chrome's type %s as people say it", (name, label) => {
    expect(formFieldLabel(name)).toBe(label);
  });

  it.each([
    ["search-query", "Search query"],
    ["wallet_address", "Wallet address"],
    ["billingPostcode", "Billing postcode"],
    ["ADDRESS_HOME_FOO", "Address home foo"],
    ["q", "Q"],
  ])("turns any other name %s into words", (name, label) => {
    expect(formFieldLabel(name)).toBe(label);
  });

  it("has no label for a missing or blank name", () => {
    expect(formFieldLabel(null)).toBeNull();
    expect(formFieldLabel("  ")).toBeNull();
  });
});
