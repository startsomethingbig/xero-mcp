import { describe, expect, it, vi } from "vitest";

import { ConfirmationStore } from "../../drafts/confirmation-store.js";
import { DraftCommandService } from "../../drafts/draft-command-service.js";
import { createDraftResourceRegistry } from "../../drafts/resource-registry.js";
import type { XeroApi } from "../client.js";
import { testEnvironment } from "../../test/environment.js";
import { createXeroApi } from "../client.js";
import { createQuoteAdapter } from "./quote.js";

const environment = testEnvironment({ tenantId: "tenant" });

const lineItems = [
  {
    lineItemID: "line-1",
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

function fakeQuoteSdk() {
  const accountingApi = {
    createQuotes: vi.fn(async () => ({
      body: { quotes: [{ quoteID: "quote-1", status: "DRAFT" }] },
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

describe("quote draft adapter", () => {
  it("creates a DRAFT quote through the quote SDK operation", async () => {
    const sdk = fakeQuoteSdk();
    const adapter = createQuoteAdapter(createXeroApi(environment, sdk));

    await adapter.create(
      {
        contactId: "contact-1",
        date: "2026-08-09",
        lineItems: [{ description: "Consulting" }],
        status: "DRAFT",
      },
      "idem-2",
    );

    expect(sdk.accountingApi.createQuotes).toHaveBeenCalledWith(
      "tenant",
      {
        quotes: [
          {
            contact: { contactID: "contact-1" },
            date: "2026-08-09",
            lineItems: [{ description: "Consulting" }],
            status: "DRAFT",
          },
        ],
      },
      true,
      "idem-2",
      expect.anything(),
    );
  });

  it("accepts only editable draft fields and strips transition and calculated fields", () => {
    const adapter = createQuoteAdapter(fakeApi());

    expect(
      adapter.parsePayload(
        {
          contactId: "contact-1",
          lineItems,
          reference: "QUOTE-8",
          status: "SENT",
          sentToContact: true,
          total: 250,
        },
        "update",
      ),
    ).toEqual({
      contactId: "contact-1",
      lineItems,
      reference: "QUOTE-8",
    });
  });

  it("preserves supplied line-item IDs on update and delegates deletion", async () => {
    const update = vi.fn().mockResolvedValue({
      quoteID: "quote-1",
      status: "DRAFT",
    });
    const remove = vi.fn().mockResolvedValue({
      quoteID: "quote-1",
      status: "DELETED",
    });
    const adapter = createQuoteAdapter(fakeApi({ update, delete: remove }));

    await adapter.update("quote-1", {
      lineItems,
      reference: "Changed",
      status: "DRAFT",
    });
    await adapter.delete("quote-1");

    expect(update).toHaveBeenCalledWith("quote", "quote-1", {
      lineItems,
      reference: "Changed",
      status: "DRAFT",
    });
    expect(remove).toHaveBeenCalledWith("quote", "quote-1");
  });

  it.each(["SENT", "DECLINED", "ACCEPTED", "INVOICED", "DELETED"])(
    "rejects a %s quote before update and delete adapter calls",
    async (status) => {
      const update = vi.fn();
      const remove = vi.fn();
      const api = fakeApi({
        get: vi.fn().mockResolvedValue({ quoteID: "quote-1", status }),
        update,
        delete: remove,
      });
      const registry = createDraftResourceRegistry(api);
      const service = new DraftCommandService({
        tenantId: "tenant",
        confirmations: new ConfirmationStore({ secret: "test-secret" }),
        getAdapter: (resource) => registry.get(resource),
      });

      await expect(
        service.preview({
          operation: "update",
          resource: "quote",
          targetId: "quote-1",
          payload: { reference: "Changed" },
        }),
      ).rejects.toMatchObject({ code: "NOT_DRAFT" });
      await expect(
        service.preview({
          operation: "delete",
          resource: "quote",
          targetId: "quote-1",
        }),
      ).rejects.toMatchObject({ code: "NOT_DRAFT" });
      expect(update).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
    },
  );

  it("exposes Xero identity, status, and version fallback order", () => {
    const adapter = createQuoteAdapter(fakeApi());

    expect(adapter.getId({ quoteID: "quote-1" })).toBe("quote-1");
    expect(adapter.getStatus({ quoteID: "quote-1", status: "DRAFT" })).toBe(
      "DRAFT",
    );
    expect(
      adapter.getVersion({
        quoteID: "quote-1",
        updatedDateUTC: new Date("2026-08-09T02:00:00.000Z"),
      }),
    ).toEqual({ value: "2026-08-09T02:00:00.000Z" });
    expect(adapter.getVersion({ quoteID: "quote-1" })).toBeUndefined();
  });
});
