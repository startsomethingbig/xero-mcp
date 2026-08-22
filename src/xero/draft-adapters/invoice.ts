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
  description: longText(),
  quantity: amount(),
  unitAmount: amount(),
  accountCode: text(),
  taxType: text(),
  itemCode: text().optional(),
  tracking: lines(trackingSchema).optional(),
});

const invoicePayloadSchema = z.object({
  contactId: text().optional(),
  lineItems: lines(lineItemSchema).optional(),
  type: z.enum(["ACCREC", "ACCPAY"]).optional(),
  reference: text().optional(),
  date: text().optional(),
  dueDate: text().optional(),
});

const invoiceCreatePayloadSchema = invoicePayloadSchema.extend({
  contactId: text(),
  lineItems: lines(lineItemSchema),
  type: z.enum(["ACCREC", "ACCPAY"]),
});

export type InvoiceDraftPayload = z.infer<typeof invoicePayloadSchema>;

export interface InvoiceRecord {
  invoiceID: string;
  status?: string;
  updatedDateUTC?: Date | string;
  [key: string]: unknown;
}

function mapPayload(payload: InvoiceDraftPayload) {
  return withoutUndefined({
    contact: payload.contactId ? { contactID: payload.contactId } : undefined,
    lineItems: payload.lineItems,
    type: payload.type,
    reference: payload.reference,
    date: payload.date,
    dueDate: payload.dueDate,
  });
}

export function createInvoiceAdapter(
  api: XeroApi,
): DraftResourceAdapter<InvoiceDraftPayload, InvoiceRecord> {
  return {
    kind: "invoice",

    parsePayload(input, operation) {
      return parseFor(
        { partial: invoicePayloadSchema, create: invoiceCreatePayloadSchema },
        input,
        operation,
      );
    },

    get(id) {
      return api.get<InvoiceRecord>("invoice", id);
    },

    create(payload, idempotencyKey) {
      const parsed = invoiceCreatePayloadSchema.parse(payload);
      const mapped = mapPayload(parsed);
      delete mapped.reference;
      const reference = parsed.reference
        ? parsed.type === "ACCPAY"
          ? { invoiceNumber: parsed.reference }
          : { reference: parsed.reference }
        : {};
      return api.create<InvoiceRecord>(
        "invoice",
        { ...mapped, ...reference, status: "DRAFT" },
        idempotencyKey,
      );
    },

    update(id, payload) {
      return api.update<InvoiceRecord>("invoice", id, {
        ...mapPayload(invoicePayloadSchema.parse(payload)),
        status: "DRAFT",
      });
    },

    delete(id) {
      return api.delete<InvoiceRecord>("invoice", id);
    },

    getId(record) {
      return record.invoiceID;
    },

    getStatus(record) {
      return record.status;
    },

    getVersion(record) {
      return versionOf(record.updatedDateUTC);
    },
  };
}
