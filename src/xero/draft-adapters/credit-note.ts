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

const lineItemSchema = z.object({
  description: longText(),
  quantity: amount(),
  unitAmount: amount(),
  accountCode: text(),
  taxType: text(),
});

const creditNotePayloadSchema = z.object({
  contactId: text().optional(),
  lineItems: lines(lineItemSchema).optional(),
  type: z.enum(["ACCRECCREDIT", "ACCPAYCREDIT"]).optional(),
  reference: text().optional(),
  date: text().optional(),
});

const creditNoteCreatePayloadSchema = creditNotePayloadSchema.extend({
  contactId: text(),
  lineItems: lines(lineItemSchema),
  type: z.enum(["ACCRECCREDIT", "ACCPAYCREDIT"]),
});

export type CreditNoteDraftPayload = z.infer<typeof creditNotePayloadSchema>;

export interface CreditNoteRecord {
  creditNoteID: string;
  status?: string;
  updatedDateUTC?: Date | string;
  [key: string]: unknown;
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

    parsePayload(input, operation) {
      return parseFor(
        {
          partial: creditNotePayloadSchema,
          create: creditNoteCreatePayloadSchema,
        },
        input,
        operation,
      );
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
      return versionOf(record.updatedDateUTC);
    },
  };
}
