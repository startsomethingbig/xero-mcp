import { describe, expect, it, vi } from "vitest";

import { ConfirmationStore } from "../../drafts/confirmation-store.js";
import { DraftCommandService } from "../../drafts/draft-command-service.js";
import { createDraftResourceRegistry } from "../../drafts/resource-registry.js";
import type { XeroApi } from "../client.js";
import { createManualJournalAdapter } from "./manual-journal.js";

const manualJournalPayload = {
  narration: "Accrue August expenses",
  journalLines: [
    {
      lineAmount: 125,
      accountCode: "400",
      description: "Expense accrual",
      taxType: "NONE",
    },
  ],
  date: "2026-08-09",
  lineAmountTypes: "NoTax",
  url: "https://example.test/accrual",
  showOnCashBasisReports: true,
};

function fakeApi(overrides: Partial<XeroApi> = {}): XeroApi {
  return {
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    ...overrides,
  };
}

describe("manual-journal draft adapter", () => {
  it("creates a DRAFT manual journal with its idempotency key", async () => {
    const create = vi.fn().mockResolvedValue({
      manualJournalID: "journal-1",
      status: "DRAFT",
    });
    const adapter = createManualJournalAdapter(fakeApi({ create }));

    await adapter.create(
      { ...manualJournalPayload, status: "DRAFT" },
      "idem-1",
    );

    expect(create).toHaveBeenCalledWith(
      "manual_journal",
      { ...manualJournalPayload, status: "DRAFT" },
      "idem-1",
    );
  });

  it("accepts only editable fields and strips caller-controlled status", () => {
    const adapter = createManualJournalAdapter(fakeApi());

    expect(
      adapter.parsePayload({
        ...manualJournalPayload,
        status: "POSTED",
        manualJournalID: "journal-1",
        totalDebit: 125,
      }),
    ).toEqual(manualJournalPayload);
  });

  it("updates with DRAFT and delegates deletion to documented draft deletion", async () => {
    const update = vi.fn().mockResolvedValue({ manualJournalID: "journal-1" });
    const remove = vi.fn().mockResolvedValue({
      manualJournalID: "journal-1",
      status: "DELETED",
    });
    const adapter = createManualJournalAdapter(
      fakeApi({ update, delete: remove }),
    );

    await adapter.update("journal-1", {
      narration: "Corrected",
      status: "DRAFT",
    });
    await adapter.delete("journal-1");

    expect(update).toHaveBeenCalledWith("manual_journal", "journal-1", {
      narration: "Corrected",
      status: "DRAFT",
    });
    expect(remove).toHaveBeenCalledWith("manual_journal", "journal-1");
  });

  it("does not update a POSTED manual journal", async () => {
    const update = vi.fn();
    const api = fakeApi({
      get: vi.fn().mockResolvedValue({
        manualJournalID: "journal-1",
        status: "POSTED",
      }),
      update,
    });
    const registry = createDraftResourceRegistry(api);
    const service = new DraftCommandService({
      tenantId: "tenant",
      confirmations: new ConfirmationStore({ secret: "test-secret" }),
      getAdapter: (resource) => registry.get(resource),
    });

    await expect(
      service.preview({
        operation: "update",
        resource: "manual_journal",
        targetId: "journal-1",
        payload: manualJournalPayload,
      }),
    ).rejects.toMatchObject({ code: "NOT_DRAFT" });
    expect(update).not.toHaveBeenCalled();
  });

  it("exposes Xero identity, status, and version fallback order", () => {
    const adapter = createManualJournalAdapter(fakeApi());

    expect(adapter.getId({ manualJournalID: "journal-1" })).toBe("journal-1");
    expect(
      adapter.getStatus({ manualJournalID: "journal-1", status: "DRAFT" }),
    ).toBe("DRAFT");
    expect(
      adapter.getVersion({
        manualJournalID: "journal-1",
        updatedDateUTCString: "2026-08-09T01:00:00.000Z",
        updatedDateUTC: new Date("2026-08-09T02:00:00.000Z"),
      }),
    ).toEqual({ value: "2026-08-09T01:00:00.000Z" });
    expect(
      adapter.getVersion({
        manualJournalID: "journal-1",
        updatedDateUTC: new Date("2026-08-09T02:00:00.000Z"),
      }),
    ).toEqual({ value: "2026-08-09T02:00:00.000Z" });
    expect(adapter.getVersion({ manualJournalID: "journal-1" })).toEqual({
      value: "journal-1",
    });
  });
});
