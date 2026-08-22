import { describe, expect, it, vi } from "vitest";

import { ConfirmationStore } from "../../drafts/confirmation-store.js";
import { DraftCommandService } from "../../drafts/draft-command-service.js";
import { createDraftResourceRegistry } from "../../drafts/resource-registry.js";
import type { XeroApi } from "../client.js";
import { testEnvironment } from "../../test/environment.js";
import { createXeroApi } from "../client.js";
import { createPurchaseOrderAdapter } from "./purchase-order.js";

const environment = testEnvironment({ tenantId: "tenant" });

const lineItems = [
  {
    lineItemID: "line-1",
    description: "Equipment",
    quantity: 1,
    unitAmount: 500,
    accountCode: "400",
    taxType: "INPUT",
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

function fakePurchaseOrderSdk() {
  const accountingApi = {
    createPurchaseOrders: vi.fn(async () => ({
      body: {
        purchaseOrders: [{ purchaseOrderID: "po-1", status: "DRAFT" }],
      },
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

describe("purchase-order draft adapter", () => {
  it("creates a DRAFT purchase order through the purchase-order SDK operation", async () => {
    const sdk = fakePurchaseOrderSdk();
    const adapter = createPurchaseOrderAdapter(createXeroApi(environment, sdk));

    await adapter.create(
      {
        contactId: "contact-1",
        date: "2026-08-09",
        lineItems: [{ description: "Equipment" }],
        status: "DRAFT",
      },
      "idem-3",
    );

    expect(sdk.accountingApi.createPurchaseOrders).toHaveBeenCalledWith(
      "tenant",
      {
        purchaseOrders: [
          {
            contact: { contactID: "contact-1" },
            date: "2026-08-09",
            lineItems: [{ description: "Equipment" }],
            status: "DRAFT",
          },
        ],
      },
      true,
      "idem-3",
      expect.anything(),
    );
  });

  it("accepts only editable draft fields and strips transition and calculated fields", () => {
    const adapter = createPurchaseOrderAdapter(fakeApi());

    expect(
      adapter.parsePayload(
        {
          contactId: "contact-1",
          deliveryAddress: "1 Harbour Street",
          lineItems,
          reference: "PO-8",
          status: "AUTHORISED",
          sentToContact: true,
          total: 500,
        },
        "update",
      ),
    ).toEqual({
      contactId: "contact-1",
      deliveryAddress: "1 Harbour Street",
      lineItems,
      reference: "PO-8",
    });
  });

  it("preserves supplied line-item IDs on update and delegates deletion", async () => {
    const update = vi.fn().mockResolvedValue({
      purchaseOrderID: "po-1",
      status: "DRAFT",
    });
    const remove = vi.fn().mockResolvedValue({
      purchaseOrderID: "po-1",
      status: "DELETED",
    });
    const adapter = createPurchaseOrderAdapter(
      fakeApi({ update, delete: remove }),
    );

    await adapter.update("po-1", {
      lineItems,
      reference: "Changed",
      status: "DRAFT",
    });
    await adapter.delete("po-1");

    expect(update).toHaveBeenCalledWith("purchase_order", "po-1", {
      lineItems,
      reference: "Changed",
      status: "DRAFT",
    });
    expect(remove).toHaveBeenCalledWith("purchase_order", "po-1");
  });

  it.each(["SUBMITTED", "AUTHORISED", "BILLED", "DELETED"])(
    "rejects a %s purchase order before update and delete adapter calls",
    async (status) => {
      const update = vi.fn();
      const remove = vi.fn();
      const api = fakeApi({
        get: vi.fn().mockResolvedValue({ purchaseOrderID: "po-1", status }),
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
          resource: "purchase_order",
          targetId: "po-1",
          payload: { reference: "Changed" },
        }),
      ).rejects.toMatchObject({ code: "NOT_DRAFT" });
      await expect(
        service.preview({
          operation: "delete",
          resource: "purchase_order",
          targetId: "po-1",
        }),
      ).rejects.toMatchObject({ code: "NOT_DRAFT" });
      expect(update).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
    },
  );

  it("exposes Xero identity, status, and version fallback order", () => {
    const adapter = createPurchaseOrderAdapter(fakeApi());

    expect(adapter.getId({ purchaseOrderID: "po-1" })).toBe("po-1");
    expect(
      adapter.getStatus({ purchaseOrderID: "po-1", status: "DRAFT" }),
    ).toBe("DRAFT");
    expect(
      adapter.getVersion({
        purchaseOrderID: "po-1",
        updatedDateUTC: new Date("2026-08-09T02:00:00.000Z"),
      }),
    ).toEqual({ value: "2026-08-09T02:00:00.000Z" });
    expect(adapter.getVersion({ purchaseOrderID: "po-1" })).toBeUndefined();
  });
});
