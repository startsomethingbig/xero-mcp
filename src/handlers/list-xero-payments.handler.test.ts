import { afterEach, describe, expect, it, vi } from "vitest";

import { xeroClient } from "../clients/xero-client.js";
import { listXeroPayments } from "./list-xero-payments.handler.js";

const INVOICE_ID = "7d0c6a5e-1c3c-4b1a-9f3e-2d0f6b7c8a9b";

describe("listXeroPayments", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function stubXero() {
    vi.spyOn(xeroClient, "authenticate").mockResolvedValue(undefined);
    return vi
      .spyOn(xeroClient.accountingApi, "getPayments")
      .mockResolvedValue({ body: { payments: [] } } as never);
  }

  it("builds the where clause from validated values only", async () => {
    const getPayments = stubXero();

    const response = await listXeroPayments(2, {
      invoiceId: INVOICE_ID,
      reference: "August deposit",
    });

    expect(response.isError).toBe(false);
    expect(getPayments).toHaveBeenCalledTimes(1);
    expect(getPayments.mock.calls[0]![2]).toBe(
      `Invoice.InvoiceID==guid("${INVOICE_ID}") AND Reference=="August deposit"`,
    );
    expect(getPayments.mock.calls[0]![4]).toBe(2);
  });

  it("refuses a reference that tries to break out of the filter", async () => {
    const getPayments = stubXero();

    const response = await listXeroPayments(1, {
      reference: 'x" OR Amount>0 OR Reference=="',
    });

    expect(response.isError).toBe(true);
    expect(response.error).toMatch(/filter value/);
    expect(getPayments).not.toHaveBeenCalled();
  });

  it("refuses an invoice id that is not a UUID", async () => {
    const getPayments = stubXero();

    const response = await listXeroPayments(1, {
      invoiceId: `${INVOICE_ID}") OR Amount>0 OR Invoice.InvoiceID==guid("${INVOICE_ID}`,
    });

    expect(response.isError).toBe(true);
    expect(getPayments).not.toHaveBeenCalled();
  });
});
