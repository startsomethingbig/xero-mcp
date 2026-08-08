import type { XeroApi } from "../xero/client.js";
import { createCreditNoteAdapter } from "../xero/draft-adapters/credit-note.js";
import { createInvoiceAdapter } from "../xero/draft-adapters/invoice.js";
import { createManualJournalAdapter } from "../xero/draft-adapters/manual-journal.js";
import { createPurchaseOrderAdapter } from "../xero/draft-adapters/purchase-order.js";
import { createQuoteAdapter } from "../xero/draft-adapters/quote.js";
import type { DraftResourceAdapter } from "./types.js";

type RegisteredDraftResourceAdapter = DraftResourceAdapter<unknown, unknown>;

export class DraftResourceRegistry {
  private readonly adapters = new Map<string, RegisteredDraftResourceAdapter>();

  constructor(adapters: RegisteredDraftResourceAdapter[]) {
    for (const adapter of adapters) {
      if (this.adapters.has(adapter.kind)) {
        throw new Error(`Duplicate draft resource: ${adapter.kind}`);
      }
      this.adapters.set(adapter.kind, adapter);
    }
  }

  get(resource: string): RegisteredDraftResourceAdapter | undefined {
    return this.adapters.get(resource);
  }
}

export function createDraftResourceRegistry(
  api: XeroApi,
): DraftResourceRegistry {
  return new DraftResourceRegistry([
    createInvoiceAdapter(api),
    createCreditNoteAdapter(api),
    createQuoteAdapter(api),
    createPurchaseOrderAdapter(api),
    createManualJournalAdapter(api),
  ]);
}
