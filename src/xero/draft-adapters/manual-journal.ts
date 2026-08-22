import { z } from "zod";

import type { DraftResourceAdapter } from "../../drafts/types.js";
import type { XeroApi } from "../client.js";
import {
  amount,
  httpsUrl,
  lines,
  longText,
  parseFor,
  text,
  versionOf,
  withoutUndefined,
} from "./shared.js";

const journalLineSchema = z.object({
  lineAmount: amount(),
  accountCode: text(),
  description: longText().optional(),
  taxType: text().optional(),
});

const manualJournalPayloadSchema = z.object({
  narration: longText().optional(),
  journalLines: lines(journalLineSchema).optional(),
  date: text().optional(),
  lineAmountTypes: text().optional(),
  url: httpsUrl().optional(),
  showOnCashBasisReports: z.boolean().optional(),
});

const manualJournalCreatePayloadSchema = manualJournalPayloadSchema.extend({
  narration: longText(),
  journalLines: lines(journalLineSchema),
});

export type ManualJournalDraftPayload = z.infer<
  typeof manualJournalPayloadSchema
>;

export interface ManualJournalRecord {
  manualJournalID: string;
  status?: string;
  updatedDateUTC?: Date | string;
  [key: string]: unknown;
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

    parsePayload(input, operation) {
      return parseFor(
        {
          partial: manualJournalPayloadSchema,
          create: manualJournalCreatePayloadSchema,
        },
        input,
        operation,
      );
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
      return versionOf(record.updatedDateUTC);
    },
  };
}
