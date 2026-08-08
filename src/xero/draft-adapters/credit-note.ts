import { z } from "zod";

import type { DraftResourceAdapter } from "../../drafts/types.js";
import type { XeroApi } from "../client.js";

const lineItemSchema = z.object({
  description: z.string(),
  quantity: z.number(),
  unitAmount: z.number(),
  accountCode: z.string(),
  taxType: z.string(),
});

const creditNotePayloadSchema = z.object({
  contactId: z.string().optional(),
  lineItems: z.array(lineItemSchema).optional(),
  type: z.enum(["ACCRECCREDIT", "ACCPAYCREDIT"]).optional(),
  reference: z.string().optional(),
  date: z.string().optional(),
});

const creditNoteCreatePayloadSchema = creditNotePayloadSchema.extend({
  contactId: z.string(),
  lineItems: z.array(lineItemSchema),
  type: z.enum(["ACCRECCREDIT", "ACCPAYCREDIT"]),
});

export type CreditNoteDraftPayload = z.infer<typeof creditNotePayloadSchema>;

export interface CreditNoteRecord {
  creditNoteID: string;
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

function mapPayload(payload: CreditNoteDraftPayload) {
  return withoutUndefined({
    contact: payload.contactId ? { contactID: payload.contactId } : undefined,
    lineItems: payload.lineItems,
    type: payload.type,
    reference: payload.reference,
    date: payload.date,
  });
}

export function createCreditNoteAdapter(
  api: XeroApi,
): DraftResourceAdapter<CreditNoteDraftPayload, CreditNoteRecord> {
  return {
    kind: "credit_note",

    parsePayload(input) {
      return withoutUndefined(creditNotePayloadSchema.parse(input));
    },

    get(id) {
      return api.get<CreditNoteRecord>("credit_note", id);
    },

    create(payload, idempotencyKey) {
      return api.create<CreditNoteRecord>(
        "credit_note",
        {
          ...mapPayload(creditNoteCreatePayloadSchema.parse(payload)),
          status: "DRAFT",
        },
        idempotencyKey,
      );
    },

    update(id, payload) {
      return api.update<CreditNoteRecord>("credit_note", id, {
        ...mapPayload(creditNotePayloadSchema.parse(payload)),
        status: "DRAFT",
      });
    },

    delete(id) {
      return api.delete<CreditNoteRecord>("credit_note", id);
    },

    getId(record) {
      return record.creditNoteID;
    },

    getStatus(record) {
      return record.status;
    },

    getVersion(record) {
      return {
        value:
          record.updatedDateUTCString ??
          record.updatedDateUTC?.toISOString() ??
          record.creditNoteID,
      };
    },
  };
}
