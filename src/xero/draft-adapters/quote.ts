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

const quotePayloadSchema = z.object({
  contactId: z.string().optional(),
  lineItems: z.array(lineItemSchema).optional(),
  quoteNumber: z.string().optional(),
  reference: z.string().optional(),
  terms: z.string().optional(),
  date: z.string().optional(),
  expiryDate: z.string().optional(),
  currencyCode: z.string().optional(),
  currencyRate: z.number().optional(),
  title: z.string().optional(),
  summary: z.string().optional(),
  brandingThemeId: z.string().optional(),
  lineAmountTypes: z.string().optional(),
});

const quoteCreatePayloadSchema = quotePayloadSchema.extend({
  contactId: z.string(),
  lineItems: z.array(lineItemSchema),
});

export type QuoteDraftPayload = z.infer<typeof quotePayloadSchema>;

export interface QuoteRecord {
  quoteID: string;
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

function mapPayload(payload: QuoteDraftPayload) {
  return withoutUndefined({
    contact: payload.contactId ? { contactID: payload.contactId } : undefined,
    lineItems: payload.lineItems,
    quoteNumber: payload.quoteNumber,
    reference: payload.reference,
    terms: payload.terms,
    date: payload.date,
    expiryDate: payload.expiryDate,
    currencyCode: payload.currencyCode,
    currencyRate: payload.currencyRate,
    title: payload.title,
    summary: payload.summary,
    brandingThemeID: payload.brandingThemeId,
    lineAmountTypes: payload.lineAmountTypes,
  });
}

export function createQuoteAdapter(
  api: XeroApi,
): DraftResourceAdapter<QuoteDraftPayload, QuoteRecord> {
  return {
    kind: "quote",

    parsePayload(input) {
      return withoutUndefined(quotePayloadSchema.parse(input));
    },

    get(id) {
      return api.get<QuoteRecord>("quote", id);
    },

    create(payload, idempotencyKey) {
      return api.create<QuoteRecord>(
        "quote",
        {
          ...mapPayload(quoteCreatePayloadSchema.parse(payload)),
          status: "DRAFT",
        },
        idempotencyKey,
      );
    },

    update(id, payload) {
      return api.update<QuoteRecord>("quote", id, {
        ...mapPayload(quotePayloadSchema.parse(payload)),
        status: "DRAFT",
      });
    },

    delete(id) {
      return api.delete<QuoteRecord>("quote", id);
    },

    getId(record) {
      return record.quoteID;
    },

    getStatus(record) {
      return record.status;
    },

    getVersion(record) {
      return {
        value:
          record.updatedDateUTCString ??
          record.updatedDateUTC?.toISOString() ??
          record.quoteID,
      };
    },
  };
}
