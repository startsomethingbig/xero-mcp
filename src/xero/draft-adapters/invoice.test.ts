import { describe, expect, it, vi } from "vitest";

import type { XeroApi } from "../client.js";
import { testEnvironment } from "../../test/environment.js";
import { createXeroApi } from "../client.js";
import { createInvoiceAdapter } from "./invoice.js";

const environment = testEnvironment({ tenantId: "tenant" });

const lineItems = [
  {
    description: "Consulting",
    quantity: 2,
    unitAmount: 125,
    accountCode: "200",
    taxType: "OUTPUT",
  },
];

function fakeApi(overrides: Partial<XeroApi> = {}): XeroApi {
  return {
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    ...overrides,
  };
}

function fakeInvoiceSdk() {
  const accountingApi = {
    createInvoices: vi.fn(async () => ({
      body: { invoices: [{ invoiceID: "invoice-1", status: "DRAFT" }] },
    })),
    updateInvoice: vi.fn(async () => ({
      body: { invoices: [{ invoiceID: "invoice-1", status: "DELETED" }] },
    })),
  };
  return {
    getClientCredentialsToken: vi.fn().mockResolvedValue({
      access_token: "access-token",
    }),
    setTokenSet: vi.fn(),
    accountingApi,
  };
}

describe("invoice draft adapter", () => {
  it("forces a new bill to DRAFT and passes the confirmation-derived idempotency key", async () => {
    const sdk = fakeInvoiceSdk();
    const adapter = createInvoiceAdapter(createXeroApi(environment, sdk));

    await adapter.create(
      {
        contactId: "contact-1",
        lineItems,
        type: "ACCPAY",
        reference: "BILL-8",
        status: "DRAFT",
      },
      "idem-1",
    );

    expect(sdk.accountingApi.createInvoices).toHaveBeenCalledWith(
      "tenant",
      {
        invoices: [
          {
            contact: { contactID: "contact-1" },
            invoiceNumber: "BILL-8",
            lineItems,
            status: "DRAFT",
            type: "ACCPAY",
          },
        ],
      },
      true,
      undefined,
      "idem-1",
      expect.anything(),
    );
  });

  it("keeps caller status out of parsed payloads and does not invent dates", () => {
    const adapter = createInvoiceAdapter(fakeApi());

    expect(
      adapter.parsePayload({
        contactId: "contact-1",
        lineItems,
        type: "ACCREC",
        reference: "INV-8",
        status: "AUTHORISED",
        dueDate: undefined,
        total: 999,
      }),
    ).toEqual({
      contactId: "contact-1",
      lineItems,
      type: "ACCREC",
      reference: "INV-8",
    });
  });

  it("maps sales references without changing the caller-supplied date", async () => {
    const create = vi.fn().mockResolvedValue({ invoiceID: "invoice-1" });
    const adapter = createInvoiceAdapter(fakeApi({ create }));

    await adapter.create(
      {
        contactId: "contact-1",
        date: "2026-08-09",
        lineItems,
        reference: "SALES-8",
        type: "ACCREC",
        status: "DRAFT",
      },
      "idem-2",
    );

    expect(create).toHaveBeenCalledWith(
      "invoice",
      {
        contact: { contactID: "contact-1" },
        date: "2026-08-09",
        lineItems,
        reference: "SALES-8",
        status: "DRAFT",
        type: "ACCREC",
      },
      "idem-2",
    );
  });

  it("updates with DRAFT and deletes through Xero's status-update operation", async () => {
    const sdk = fakeInvoiceSdk();
    const adapter = createInvoiceAdapter(createXeroApi(environment, sdk));

    await adapter.update("invoice-1", {
      reference: "Changed",
      status: "DRAFT",
    });
    expect(sdk.accountingApi.updateInvoice).toHaveBeenLastCalledWith(
      "tenant",
      "invoice-1",
      { invoices: [{ reference: "Changed", status: "DRAFT" }] },
      undefined,
      undefined,
      expect.anything(),
    );

    await adapter.delete("invoice-1");
    expect(sdk.accountingApi.updateInvoice).toHaveBeenLastCalledWith(
      "tenant",
      "invoice-1",
      { invoices: [{ status: "DELETED" }] },
      undefined,
      undefined,
      expect.anything(),
    );
  });

  it("uses Xero status and the documented version fallback order", () => {
    const adapter = createInvoiceAdapter(fakeApi());

    expect(
      adapter.getStatus({ invoiceID: "invoice-1", status: "AUTHORISED" }),
    ).toBe("AUTHORISED");
    expect(
      adapter.getVersion({
        invoiceID: "invoice-1",
        updatedDateUTCString: "2026-08-09T01:00:00.000Z",
        updatedDateUTC: new Date("2026-08-09T02:00:00.000Z"),
      }),
    ).toEqual({ value: "2026-08-09T01:00:00.000Z" });
    expect(
      adapter.getVersion({
        invoiceID: "invoice-1",
        updatedDateUTC: new Date("2026-08-09T02:00:00.000Z"),
      }),
    ).toEqual({ value: "2026-08-09T02:00:00.000Z" });
    expect(adapter.getVersion({ invoiceID: "invoice-1" })).toEqual({
      value: "invoice-1",
    });
  });
});
