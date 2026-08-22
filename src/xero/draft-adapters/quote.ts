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

const quotePayloadSchema = z.object({
  contactId: text().optional(),
  lineItems: lines(lineItemSchema).optional(),
  quoteNumber: text().optional(),
  reference: text().optional(),
  terms: text().optional(),
  date: text().optional(),
  expiryDate: text().optional(),
  currencyCode: text().optional(),
  currencyRate: amount().optional(),
  title: text().optional(),
  summary: text().optional(),
  brandingThemeId: text().optional(),
  lineAmountTypes: text().optional(),
});

const quoteCreatePayloadSchema = quotePayloadSchema.extend({
  contactId: text(),
  lineItems: lines(lineItemSchema),
});

export type QuoteDraftPayload = z.infer<typeof quotePayloadSchema>;

export interface QuoteRecord {
  quoteID: string;
  status?: string;
  updatedDateUTC?: Date | string;
  [key: string]: unknown;
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

    parsePayload(input, operation) {
      return parseFor(
        { partial: quotePayloadSchema, create: quoteCreatePayloadSchema },
        input,
        operation,
      );
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
      return versionOf(record.updatedDateUTC);
    },
  };
}
