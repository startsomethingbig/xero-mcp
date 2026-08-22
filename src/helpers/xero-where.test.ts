import { describe, expect, it } from "vitest";

import { guidFilter, stringFilter, whereAll } from "./xero-where.js";

const UUID = "7d0c6a5e-1c3c-4b1a-9f3e-2d0f6b7c8a9b";

describe("Xero where-clause builders", () => {
  it("builds a guid comparison from a validated UUID", () => {
    expect(guidFilter("Invoice.InvoiceID", UUID)).toBe(
      `Invoice.InvoiceID==guid("${UUID}")`,
    );
    expect(guidFilter("PaymentID", UUID.toUpperCase())).toBe(
      `PaymentID==guid("${UUID}")`,
    );
  });

  it.each([
    "not-a-uuid",
    `${UUID}") OR Amount>0 OR PaymentID==guid("${UUID}`,
    "",
    " ",
  ])("rejects %s as a guid filter value", (value) => {
    expect(() => guidFilter("PaymentID", value)).toThrow(/valid Xero ID/);
  });

  it("builds a quoted string comparison", () => {
    expect(stringFilter("Reference", "INV-0042 deposit")).toBe(
      `Reference=="INV-0042 deposit"`,
    );
  });

  it.each([`x" OR Amount>0 OR Reference=="`, `x\\`, "x\n", "x".repeat(256)])(
    "rejects %s as a string filter value",
    (value) => {
      expect(() => stringFilter("Reference", value)).toThrow(/filter value/);
    },
  );

  it("joins conditions with AND and returns undefined for none", () => {
    expect(whereAll([])).toBeUndefined();
    expect(whereAll([undefined, 'A=="1"', undefined, 'B=="2"'])).toBe(
      'A=="1" AND B=="2"',
    );
  });
});
