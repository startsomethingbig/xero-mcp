import { z } from "zod";

import type { DraftResourceAdapter } from "../../drafts/types.js";
import type { XeroApi } from "../client.js";

const trackingSchema = z.object({
  name: z.string(),
  option: z.string(),
  trackingCategoryID: z.string(),
});

const lineItemSchema = z.object({
  lineItemID: z.string().optional(),
  description: z.string(),
  quantity: z.number().optional(),
  unitAmount: z.number().optional(),
  accountCode: z.string().optional(),
  taxType: z.string().optional(),
  itemCode: z.string().optional(),
  tracking: z.array(trackingSchema).optional(),
  discountRate: z.number().optional(),
  discountAmount: z.number().optional(),
});

const purchaseOrderPayloadSchema = z.object({
  contactId: z.string().optional(),
  lineItems: z.array(lineItemSchema).optional(),
  date: z.string().optional(),
  deliveryDate: z.string().optional(),
  lineAmountTypes: z.string().optional(),
  purchaseOrderNumber: z.string().optional(),
  reference: z.string().optional(),
  brandingThemeId: z.string().optional(),
  currencyCode: z.string().optional(),
  deliveryAddress: z.string().optional(),
  attentionTo: z.string().optional(),
  telephone: z.string().optional(),
  deliveryInstructions: z.string().optional(),
  expectedArrivalDate: z.string().optional(),
});

const purchaseOrderCreatePayloadSchema = purchaseOrderPayloadSchema.extend({
  contactId: z.string(),
  lineItems: z.array(lineItemSchema),
});

export type PurchaseOrderDraftPayload = z.infer<
  typeof purchaseOrderPayloadSchema
>;

export interface PurchaseOrderRecord {
  purchaseOrderID: string;
  status?: string;
  updatedDateUTCString?: string;
  updatedDateUTC?: Date;
  [key: string]: unknown;
}

function withoutUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, field]) => field !== undefined),
  );
}

function mapPayload(payload: PurchaseOrderDraftPayload) {
  return withoutUndefined({
    contact: payload.contactId ? { contactID: payload.contactId } : undefined,
    lineItems: payload.lineItems,
    date: payload.date,
    deliveryDate: payload.deliveryDate,
    lineAmountTypes: payload.lineAmountTypes,
    purchaseOrderNumber: payload.purchaseOrderNumber,
    reference: payload.reference,
    brandingThemeID: payload.brandingThemeId,
    currencyCode: payload.currencyCode,
    deliveryAddress: payload.deliveryAddress,
    attentionTo: payload.attentionTo,
    telephone: payload.telephone,
    deliveryInstructions: payload.deliveryInstructions,
    expectedArrivalDate: payload.expectedArrivalDate,
  });
}

export function createPurchaseOrderAdapter(
  api: XeroApi,
): DraftResourceAdapter<PurchaseOrderDraftPayload, PurchaseOrderRecord> {
  return {
    kind: "purchase_order",

    parsePayload(input) {
      return withoutUndefined(purchaseOrderPayloadSchema.parse(input));
    },

    get(id) {
      return api.get<PurchaseOrderRecord>("purchase_order", id);
    },

    create(payload, idempotencyKey) {
      return api.create<PurchaseOrderRecord>(
        "purchase_order",
        {
          ...mapPayload(purchaseOrderCreatePayloadSchema.parse(payload)),
          status: "DRAFT",
        },
        idempotencyKey,
      );
    },

    update(id, payload) {
      return api.update<PurchaseOrderRecord>("purchase_order", id, {
        ...mapPayload(purchaseOrderPayloadSchema.parse(payload)),
        status: "DRAFT",
      });
    },

    delete(id) {
      return api.delete<PurchaseOrderRecord>("purchase_order", id);
    },

    getId(record) {
      return record.purchaseOrderID;
    },

    getStatus(record) {
      return record.status;
    },

    getVersion(record) {
      return {
        value:
          record.updatedDateUTCString ??
          record.updatedDateUTC?.toISOString() ??
          record.purchaseOrderID,
      };
    },
  };
}
