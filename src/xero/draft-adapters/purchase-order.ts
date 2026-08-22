import { z } from "zod";

import type { DraftResourceAdapter } from "../../drafts/types.js";
import type { XeroApi } from "../client.js";
import {
  amount,
  lines,
  longText,
  parseFor,
  text,
  versionOf,
  withoutUndefined,
} from "./shared.js";

const trackingSchema = z.object({
  name: text(),
  option: text(),
  trackingCategoryID: text(),
});

const lineItemSchema = z.object({
  lineItemID: text().optional(),
  description: longText(),
  quantity: amount().optional(),
  unitAmount: amount().optional(),
  accountCode: text().optional(),
  taxType: text().optional(),
  itemCode: text().optional(),
  tracking: lines(trackingSchema).optional(),
  discountRate: amount().optional(),
  discountAmount: amount().optional(),
});

const purchaseOrderPayloadSchema = z.object({
  contactId: text().optional(),
  lineItems: lines(lineItemSchema).optional(),
  date: text().optional(),
  deliveryDate: text().optional(),
  lineAmountTypes: text().optional(),
  purchaseOrderNumber: text().optional(),
  reference: text().optional(),
  brandingThemeId: text().optional(),
  currencyCode: text().optional(),
  deliveryAddress: text().optional(),
  attentionTo: text().optional(),
  telephone: text().optional(),
  deliveryInstructions: text().optional(),
  expectedArrivalDate: text().optional(),
});

const purchaseOrderCreatePayloadSchema = purchaseOrderPayloadSchema.extend({
  contactId: text(),
  lineItems: lines(lineItemSchema),
});

export type PurchaseOrderDraftPayload = z.infer<
  typeof purchaseOrderPayloadSchema
>;

export interface PurchaseOrderRecord {
  purchaseOrderID: string;
  status?: string;
  updatedDateUTC?: Date | string;
  [key: string]: unknown;
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

    parsePayload(input, operation) {
      return parseFor(
        {
          partial: purchaseOrderPayloadSchema,
          create: purchaseOrderCreatePayloadSchema,
        },
        input,
        operation,
      );
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
      return versionOf(record.updatedDateUTC);
    },
  };
}
