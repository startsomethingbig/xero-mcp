import { describe, expect, it, vi } from "vitest";

import type { XeroEnvironment } from "../config/environment.js";
import {
  DraftStateError,
  UnsupportedDraftResourceError,
  XeroConflictError,
} from "../drafts/errors.js";
import { createXeroApi, formatXeroError } from "./client.js";

const environment: XeroEnvironment = {
  clientId: "client-id",
  clientSecret: "client-secret",
  tenantId: "configured-tenant",
  port: 3000,
  confirmationTtlSeconds: 600,
  confirmationSecret: "confirmation-secret",
};

const resourceCases = [
  {
    resource: "invoice",
    collection: "invoices",
    getMethod: "getInvoice",
    createMethod: "createInvoices",
    updateMethod: "updateInvoice",
    usesUnitdp: true,
    summarizesCreate: true,
  },
  {
    resource: "credit_note",
    collection: "creditNotes",
    getMethod: "getCreditNote",
    createMethod: "createCreditNotes",
    updateMethod: "updateCreditNote",
    usesUnitdp: true,
    summarizesCreate: true,
  },
  {
    resource: "quote",
    collection: "quotes",
    getMethod: "getQuote",
    createMethod: "createQuotes",
    updateMethod: "updateQuote",
    usesUnitdp: false,
    summarizesCreate: true,
  },
  {
    resource: "purchase_order",
    collection: "purchaseOrders",
    getMethod: "getPurchaseOrder",
    createMethod: "createPurchaseOrders",
    updateMethod: "updatePurchaseOrder",
    usesUnitdp: false,
    summarizesCreate: true,
  },
  {
    resource: "manual_journal",
    collection: "manualJournals",
    getMethod: "getManualJournal",
    createMethod: "createManualJournals",
    updateMethod: "updateManualJournal",
    usesUnitdp: false,
    summarizesCreate: true,
  },
  {
    resource: "repeating_invoice",
    collection: "repeatingInvoices",
    getMethod: "getRepeatingInvoice",
    createMethod: "createRepeatingInvoices",
    updateMethod: "updateRepeatingInvoice",
    usesUnitdp: false,
    summarizesCreate: true,
  },
  {
    resource: "receipt",
    collection: "receipts",
    getMethod: "getReceipt",
    createMethod: "createReceipt",
    updateMethod: "updateReceipt",
    usesUnitdp: true,
    summarizesCreate: false,
  },
] as const;

function fakeSdkForDraftResources() {
  const accountingApi: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const resourceCase of resourceCases) {
    for (const method of [
      resourceCase.getMethod,
      resourceCase.createMethod,
      resourceCase.updateMethod,
    ]) {
      accountingApi[method] = vi.fn(async () => ({
        body: {
          [resourceCase.collection]: [{ resource: resourceCase.resource }],
        },
      }));
    }
  }

  const draftAccountingApi = Object.assign(accountingApi, {
    getInvoice: accountingApi.getInvoice!,
    createInvoices: accountingApi.createInvoices!,
    updateInvoice: accountingApi.updateInvoice!,
  });

  return {
    getClientCredentialsToken: vi.fn().mockResolvedValue({
      access_token: "access-token",
    }),
    setTokenSet: vi.fn(),
    accountingApi: draftAccountingApi,
  };
}

function fakeSdkWithConnections(tenantIds: string[]) {
  const sdk = {
    tenants: tenantIds.map((tenantId) => ({ tenantId })),
    lastTenantId: undefined as string | undefined,
    getClientCredentialsToken: vi.fn().mockResolvedValue({
      access_token: "access-token",
      token_type: "Bearer",
      expires_in: 1800,
    }),
    setTokenSet: vi.fn(),
    accountingApi: {
      getInvoice: vi.fn(async (tenantId: string, invoiceId: string) => {
        sdk.lastTenantId = tenantId;
        return { body: { invoices: [{ invoiceID: invoiceId }] } };
      }),
      createInvoices: vi.fn(async (tenantId: string) => {
        sdk.lastTenantId = tenantId;
        return { body: { invoices: [{ invoiceID: "invoice-1" }] } };
      }),
      updateInvoice: vi.fn(
        async (
          tenantId: string,
          invoiceId: string,
          payload: { invoices: unknown[] },
        ) => {
          sdk.lastTenantId = tenantId;
          return {
            body: {
              invoices: [
                {
                  invoiceID: invoiceId,
                  ...(payload.invoices[0] as Record<string, unknown>),
                },
              ],
            },
          };
        },
      ),
    },
  };

  return sdk;
}

describe("createXeroApi", () => {
  it("uses the configured tenant instead of the first connected tenant", async () => {
    const sdk = fakeSdkWithConnections(["wrong-tenant", "configured-tenant"]);
    const api = createXeroApi(environment, sdk);

    await api.create("invoice", { status: "DRAFT" }, "idem-1");

    expect(sdk.lastTenantId).toBe("configured-tenant");
  });

  it("gets an invoice through the configured tenant", async () => {
    const sdk = fakeSdkWithConnections(["wrong-tenant"]);
    const api = createXeroApi(environment, sdk);

    const invoice = await api.get<{ invoiceID: string }>(
      "invoice",
      "invoice-1",
    );

    expect(invoice).toEqual({ invoiceID: "invoice-1" });
    expect(sdk.lastTenantId).toBe("configured-tenant");
  });

  it("updates an invoice through the configured tenant", async () => {
    const sdk = fakeSdkWithConnections(["wrong-tenant"]);
    const api = createXeroApi(environment, sdk);

    const invoice = await api.update<{ invoiceID: string; status: string }>(
      "invoice",
      "invoice-1",
      { status: "DRAFT" },
    );

    expect(invoice).toEqual({ invoiceID: "invoice-1", status: "DRAFT" });
    expect(sdk.accountingApi.updateInvoice).toHaveBeenCalledWith(
      "configured-tenant",
      "invoice-1",
      { invoices: [{ status: "DRAFT" }] },
      undefined,
      undefined,
      expect.anything(),
    );
  });

  it("deletes an invoice by setting its status through the configured tenant", async () => {
    const sdk = fakeSdkWithConnections(["wrong-tenant"]);
    const api = createXeroApi(environment, sdk);

    const invoice = await api.delete<{ invoiceID: string; status: string }>(
      "invoice",
      "invoice-1",
    );

    expect(invoice).toEqual({ invoiceID: "invoice-1", status: "DELETED" });
    expect(sdk.accountingApi.updateInvoice).toHaveBeenCalledWith(
      "configured-tenant",
      "invoice-1",
      { invoices: [{ status: "DELETED" }] },
      undefined,
      undefined,
      expect.anything(),
    );
  });

  it("rejects a resource that the draft boundary does not support", async () => {
    const sdk = fakeSdkWithConnections([]);
    const api = createXeroApi(environment, sdk);

    await expect(api.get("payment", "payment-1")).rejects.toBeInstanceOf(
      UnsupportedDraftResourceError,
    );
    expect(sdk.getClientCredentialsToken).not.toHaveBeenCalled();
  });

  it.each(resourceCases)(
    "creates $resource with the SDK idempotency key",
    async (resourceCase) => {
      const sdk = fakeSdkForDraftResources();
      const api = createXeroApi(environment, sdk);

      await api.create(resourceCase.resource, { status: "DRAFT" }, "idem-1");

      const prefix = [
        "configured-tenant",
        { [resourceCase.collection]: [{ status: "DRAFT" }] },
      ];
      const expectedArguments = resourceCase.usesUnitdp
        ? resourceCase.summarizesCreate
          ? [...prefix, true, undefined, "idem-1", expect.anything()]
          : [...prefix, undefined, "idem-1", expect.anything()]
        : [...prefix, true, "idem-1", expect.anything()];
      expect(sdk.accountingApi[resourceCase.createMethod]).toHaveBeenCalledWith(
        ...expectedArguments,
      );
    },
  );

  it.each(resourceCases)(
    "gets $resource through its SDK method",
    async (resourceCase) => {
      const sdk = fakeSdkForDraftResources();
      const api = createXeroApi(environment, sdk);

      const record = await api.get(resourceCase.resource, "record-1");

      expect(record).toEqual({ resource: resourceCase.resource });
      const expectedArguments = resourceCase.usesUnitdp
        ? ["configured-tenant", "record-1", undefined, expect.anything()]
        : ["configured-tenant", "record-1", expect.anything()];
      expect(sdk.accountingApi[resourceCase.getMethod]).toHaveBeenCalledWith(
        ...expectedArguments,
      );
    },
  );

  it.each(resourceCases)(
    "updates $resource through its SDK method",
    async (resourceCase) => {
      const sdk = fakeSdkForDraftResources();
      const api = createXeroApi(environment, sdk);

      await api.update(resourceCase.resource, "record-1", { status: "DRAFT" });

      const prefix = [
        "configured-tenant",
        "record-1",
        { [resourceCase.collection]: [{ status: "DRAFT" }] },
      ];
      const expectedArguments = resourceCase.usesUnitdp
        ? [...prefix, undefined, undefined, expect.anything()]
        : [...prefix, undefined, expect.anything()];
      expect(sdk.accountingApi[resourceCase.updateMethod]).toHaveBeenCalledWith(
        ...expectedArguments,
      );
    },
  );

  it.each(resourceCases.filter(({ resource }) => resource !== "receipt"))(
    "deletes $resource through its documented status update",
    async (resourceCase) => {
      const sdk = fakeSdkForDraftResources();
      const api = createXeroApi(environment, sdk);

      await api.delete(resourceCase.resource, "record-1");

      const prefix = [
        "configured-tenant",
        "record-1",
        { [resourceCase.collection]: [{ status: "DELETED" }] },
      ];
      const expectedArguments = resourceCase.usesUnitdp
        ? [...prefix, undefined, undefined, expect.anything()]
        : [...prefix, undefined, expect.anything()];
      expect(sdk.accountingApi[resourceCase.updateMethod]).toHaveBeenCalledWith(
        ...expectedArguments,
      );
    },
  );

  it("defers receipt deletion until receipt context and legacy scope are available", async () => {
    const sdk = fakeSdkForDraftResources();
    const api = createXeroApi(environment, sdk);

    await expect(api.delete("receipt", "receipt-1")).rejects.toBeInstanceOf(
      UnsupportedDraftResourceError,
    );
    expect(sdk.getClientCredentialsToken).not.toHaveBeenCalled();
    expect(sdk.accountingApi.updateReceipt).not.toHaveBeenCalled();
  });
});

describe("formatXeroError", () => {
  it("redacts a bearer token in an upstream error", () => {
    expect(
      formatXeroError(new Error("Authorization: Bearer secret-token")),
    ).toBe("Xero request failed");
  });
});

describe("draft boundary errors", () => {
  it("provides stable machine-readable error codes", () => {
    expect(
      new DraftStateError("invoice", "invoice-1", "AUTHORISED"),
    ).toMatchObject({ code: "NOT_DRAFT" });
    expect(new UnsupportedDraftResourceError("payment")).toMatchObject({
      code: "UNSUPPORTED_DRAFT_RESOURCE",
    });
    expect(new XeroConflictError("invoice", "invoice-1")).toMatchObject({
      code: "XERO_CONFLICT",
    });
  });
});

describe("legacy Xero client compatibility", () => {
  it("does not validate Xero environment variables during module loading", async () => {
    vi.resetModules();
    vi.stubEnv("XERO_CLIENT_ID", "");
    vi.stubEnv("XERO_CLIENT_SECRET", "");
    vi.stubEnv("XERO_CLIENT_BEARER_TOKEN", "");
    vi.stubEnv("XERO_TENANT_ID", "configured-tenant");

    await expect(import("../clients/xero-client.js")).resolves.toMatchObject({
      xeroClient: { tenantId: "configured-tenant" },
    });

    vi.unstubAllEnvs();
  });

  it("does not expose a bearer token from a legacy upstream error", async () => {
    vi.resetModules();
    const { xeroClient } = await import("../clients/xero-client.js");
    vi.spyOn(xeroClient, "authenticate").mockRejectedValue(
      new Error("Authorization: Bearer legacy-secret"),
    );

    await expect(xeroClient.getShortCode()).rejects.toThrow(
      "Failed to get Organisation short code: Xero request failed",
    );
  });
});
