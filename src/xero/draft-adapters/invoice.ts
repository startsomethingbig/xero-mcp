import { z } from "zod";

import type { DraftResourceAdapter } from "../../drafts/types.js";
import type { XeroApi } from "../client.js";

const trackingSchema = z.object({
  name: z.string(),
  option: z.string(),
  trackingCategoryID: z.string(),
});

const lineItemSchema = z.object({
  description: z.string(),
  quantity: z.number(),
  unitAmount: z.number(),
  accountCode: z.string(),
  taxType: z.string(),
  itemCode: z.string().optional(),
  tracking: z.array(trackingSchema).optional(),
});

const invoicePayloadSchema = z.object({
  contactId: z.string().optional(),
  lineItems: z.array(lineItemSchema).optional(),
  type: z.enum(["ACCREC", "ACCPAY"]).optional(),
  reference: z.string().optional(),
  date: z.string().optional(),
  dueDate: z.string().optional(),
});

const invoiceCreatePayloadSchema = invoicePayloadSchema.extend({
  contactId: z.string(),
  lineItems: z.array(lineItemSchema),
  type: z.enum(["ACCREC", "ACCPAY"]),
});

export type InvoiceDraftPayload = z.infer<typeof invoicePayloadSchema>;

export interface InvoiceRecord {
  invoiceID: string;
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

    parsePayload(input) {
      return withoutUndefined(invoicePayloadSchema.parse(input));
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
      return {
        value:
          record.updatedDateUTCString ??
          record.updatedDateUTC?.toISOString() ??
          record.invoiceID,
      };
    },
  };
}
