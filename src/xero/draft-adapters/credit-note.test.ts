import { describe, expect, it, vi } from "vitest";

import type { XeroApi } from "../client.js";
import { createCreditNoteAdapter } from "./credit-note.js";

const lineItems = [
  {
    description: "Refund",
    quantity: 1,
    unitAmount: 50,
    accountCode: "200",
    taxType: "OUTPUT",
  },
];

function fakeApi(overrides: Partial<XeroApi> = {}): XeroApi {
  return {
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    ...overrides,
  };
}

describe("credit-note draft adapter", () => {
  it.each(["ACCRECCREDIT", "ACCPAYCREDIT"] as const)(
    "creates a DRAFT %s credit note with its idempotency key",
    async (type) => {
      const create = vi.fn().mockResolvedValue({
        creditNoteID: "credit-note-1",
        status: "DRAFT",
      });
      const adapter = createCreditNoteAdapter(fakeApi({ create }));

      await adapter.create(
        {
          contactId: "contact-1",
          lineItems,
          reference: "CN-8",
          type,
          status: "DRAFT",
        },
        "idem-1",
      );

      expect(create).toHaveBeenCalledWith(
        "credit_note",
        {
          contact: { contactID: "contact-1" },
          lineItems,
          reference: "CN-8",
          status: "DRAFT",
          type,
        },
        "idem-1",
      );
    },
  );

  it("strips caller-controlled status and unknown calculated fields", () => {
    const adapter = createCreditNoteAdapter(fakeApi());

    expect(
      adapter.parsePayload({
        contactId: "contact-1",
        lineItems,
        type: "ACCRECCREDIT",
        status: "AUTHORISED",
        total: 50,
      }),
    ).toEqual({
      contactId: "contact-1",
      lineItems,
      type: "ACCRECCREDIT",
    });
  });

  it("updates with DRAFT and delegates deletion to the documented status update", async () => {
    const update = vi.fn().mockResolvedValue({ creditNoteID: "credit-note-1" });
    const remove = vi.fn().mockResolvedValue({
      creditNoteID: "credit-note-1",
      status: "DELETED",
    });
    const adapter = createCreditNoteAdapter(
      fakeApi({ update, delete: remove }),
    );

    await adapter.update("credit-note-1", {
      reference: "Changed",
      status: "DRAFT",
    });
    await adapter.delete("credit-note-1");

    expect(update).toHaveBeenCalledWith("credit_note", "credit-note-1", {
      reference: "Changed",
      status: "DRAFT",
    });
    expect(remove).toHaveBeenCalledWith("credit_note", "credit-note-1");
  });

  it("gets the record and exposes Xero identity, status, and version", async () => {
    const record = {
      creditNoteID: "credit-note-1",
      status: "DRAFT",
      updatedDateUTCString: "2026-08-09T01:00:00.000Z",
    };
    const get = vi.fn().mockResolvedValue(record);
    const adapter = createCreditNoteAdapter(fakeApi({ get }));

    await expect(adapter.get("credit-note-1")).resolves.toBe(record);
    expect(get).toHaveBeenCalledWith("credit_note", "credit-note-1");
    expect(adapter.getId(record)).toBe("credit-note-1");
    expect(adapter.getStatus(record)).toBe("DRAFT");
    expect(adapter.getVersion(record)).toEqual({
      value: "2026-08-09T01:00:00.000Z",
    });
    expect(
      adapter.getVersion({
        creditNoteID: "credit-note-1",
        updatedDateUTC: new Date("2026-08-09T02:00:00.000Z"),
      }),
    ).toEqual({ value: "2026-08-09T02:00:00.000Z" });
    expect(adapter.getVersion({ creditNoteID: "credit-note-1" })).toEqual({
      value: "credit-note-1",
    });
  });
});
