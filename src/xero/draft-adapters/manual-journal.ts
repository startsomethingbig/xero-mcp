import { z } from "zod";

import type { DraftResourceAdapter } from "../../drafts/types.js";
import type { XeroApi } from "../client.js";

const journalLineSchema = z.object({
  lineAmount: z.number(),
  accountCode: z.string(),
  description: z.string().optional(),
  taxType: z.string().optional(),
});

const manualJournalPayloadSchema = z.object({
  narration: z.string().optional(),
  journalLines: z.array(journalLineSchema).optional(),
  date: z.string().optional(),
  lineAmountTypes: z.string().optional(),
  url: z.string().optional(),
  showOnCashBasisReports: z.boolean().optional(),
});

const manualJournalCreatePayloadSchema = manualJournalPayloadSchema.extend({
  narration: z.string(),
  journalLines: z.array(journalLineSchema),
});

export type ManualJournalDraftPayload = z.infer<
  typeof manualJournalPayloadSchema
>;

export interface ManualJournalRecord {
  manualJournalID: string;
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

function mapPayload(payload: ManualJournalDraftPayload) {
  return withoutUndefined({
    narration: payload.narration,
    journalLines: payload.journalLines,
    date: payload.date,
    lineAmountTypes: payload.lineAmountTypes,
    url: payload.url,
    showOnCashBasisReports: payload.showOnCashBasisReports,
  });
}

export function createManualJournalAdapter(
  api: XeroApi,
): DraftResourceAdapter<ManualJournalDraftPayload, ManualJournalRecord> {
  return {
    kind: "manual_journal",

    parsePayload(input) {
      return withoutUndefined(manualJournalPayloadSchema.parse(input));
    },

    get(id) {
      return api.get<ManualJournalRecord>("manual_journal", id);
    },

    create(payload, idempotencyKey) {
      return api.create<ManualJournalRecord>(
        "manual_journal",
        {
          ...mapPayload(manualJournalCreatePayloadSchema.parse(payload)),
          status: "DRAFT",
        },
        idempotencyKey,
      );
    },

    update(id, payload) {
      return api.update<ManualJournalRecord>("manual_journal", id, {
        ...mapPayload(manualJournalPayloadSchema.parse(payload)),
        status: "DRAFT",
      });
    },

    delete(id) {
      return api.delete<ManualJournalRecord>("manual_journal", id);
    },

    getId(record) {
      return record.manualJournalID;
    },

    getStatus(record) {
      return record.status;
    },

    getVersion(record) {
      return {
        value:
          record.updatedDateUTCString ??
          record.updatedDateUTC?.toISOString() ??
          record.manualJournalID,
      };
    },
  };
}
