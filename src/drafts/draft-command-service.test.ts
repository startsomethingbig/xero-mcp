import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { DraftResourceAdapter } from "./types.js";
import { ConfirmationStore } from "./confirmation-store.js";
import { DraftCommandService } from "./draft-command-service.js";

type InvoicePayload = { reference: string; status?: string };
type Invoice = {
  id: string;
  reference: string;
  status: string;
  version: string;
};

const invoicePayload = { reference: "August services" };

class FakeInvoiceAdapter implements DraftResourceAdapter<
  InvoicePayload,
  Invoice
> {
  readonly kind = "invoice";
  record: Invoice | undefined;
  readonly getCalls: string[] = [];
  readonly createCalls: Array<{
    payload: InvoicePayload & { status: "DRAFT" };
    idempotencyKey: string;
  }> = [];
  readonly updateCalls: Array<{
    id: string;
    payload: InvoicePayload & { status: "DRAFT" };
  }> = [];
  readonly deleteCalls: string[] = [];

  constructor(record?: Partial<Invoice>) {
    this.record = record
      ? {
          id: "inv-1",
          reference: "Existing invoice",
          status: "DRAFT",
          version: "v1",
          ...record,
        }
      : undefined;
  }

  parsePayload(input: unknown): InvoicePayload {
    if (!input || typeof input !== "object") throw new TypeError("payload");
    const payload = input as Partial<InvoicePayload>;
    if (typeof payload.reference !== "string") throw new TypeError("reference");
    return { reference: payload.reference, status: payload.status };
  }

  async get(id: string): Promise<Invoice | undefined> {
    this.getCalls.push(id);
    return this.record ? { ...this.record } : undefined;
  }

  async create(
    payload: InvoicePayload & { status: "DRAFT" },
    idempotencyKey: string,
  ): Promise<Invoice> {
    this.createCalls.push({ payload, idempotencyKey });
    return {
      id: "inv-created",
      reference: payload.reference,
      status: payload.status,
      version: "v1",
    };
  }

  async update(
    id: string,
    payload: InvoicePayload & { status: "DRAFT" },
  ): Promise<Invoice> {
    this.updateCalls.push({ id, payload });
    return {
      id,
      reference: payload.reference,
      status: payload.status,
      version: "v2",
    };
  }

  async delete(id: string): Promise<Invoice> {
    this.deleteCalls.push(id);
    return {
      id,
      reference: this.record?.reference ?? "Deleted invoice",
      status: "DELETED",
      version: "v2",
    };
  }

  getId(record: Invoice): string {
    return record.id;
  }

  getStatus(record: Invoice): string {
    return record.status;
  }

  getVersion(record: Invoice) {
    return { value: record.version };
  }
}

function buildDraftService(record?: Partial<Invoice>) {
  let now = new Date("2026-08-09T00:00:00.000Z");
  let randomByte = 0;
  const clock = () => now;
  const confirmations = new ConfirmationStore({
    secret: "test-secret",
    clock,
    randomBytes: (size) => new Uint8Array(size).fill(++randomByte),
  });
  const adapter = new FakeInvoiceAdapter(record);
  const service = new DraftCommandService({
    tenantId: "tenant-1",
    confirmationTtlSeconds: 600,
    clock,
    confirmations,
    getAdapter: (resource) => (resource === "invoice" ? adapter : undefined),
  });

  return {
    service,
    adapter,
    setNow(iso: string) {
      now = new Date(iso);
    },
  };
}

describe("DraftCommandService", () => {
  it("does not mutate during preview and accepts a create token once", async () => {
    const { service, adapter } = buildDraftService();

    const preview = await service.preview({
      operation: "create",
      resource: "invoice",
      payload: invoicePayload,
    });

    expect(preview).toMatchObject({
      operation: "create",
      resource: "invoice",
      payload: { ...invoicePayload, status: "DRAFT" },
      expiresAt: "2026-08-09T00:10:00.000Z",
    });
    expect(adapter.createCalls).toHaveLength(0);

    const applied = await service.apply(preview.confirmationToken);

    expect(applied).toMatchObject({
      operation: "create",
      resource: "invoice",
      targetId: "inv-created",
      record: { status: "DRAFT" },
    });
    expect(adapter.createCalls).toEqual([
      {
        payload: { ...invoicePayload, status: "DRAFT" },
        idempotencyKey: createHmac("sha256", "test-secret")
          .update(preview.confirmationToken)
          .digest("hex"),
      },
    ]);
    await expect(
      service.apply(preview.confirmationToken),
    ).rejects.toMatchObject({ code: "CONFIRMATION_USED" });
    expect(adapter.createCalls).toHaveLength(1);
  });

  it("rejects a tampered create token before mutation", async () => {
    const { service, adapter } = buildDraftService();
    const preview = await service.preview({
      operation: "create",
      resource: "invoice",
      payload: invoicePayload,
    });
    const token = preview.confirmationToken;
    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;

    await expect(service.apply(tampered)).rejects.toMatchObject({
      code: "CONFIRMATION_INVALID",
    });
    expect(adapter.createCalls).toHaveLength(0);
  });

  it("rejects an expired create token before mutation", async () => {
    const { service, adapter, setNow } = buildDraftService();
    const preview = await service.preview({
      operation: "create",
      resource: "invoice",
      payload: invoicePayload,
    });
    setNow("2026-08-09T00:10:00.001Z");

    await expect(
      service.apply(preview.confirmationToken),
    ).rejects.toMatchObject({ code: "CONFIRMATION_EXPIRED" });
    expect(adapter.createCalls).toHaveLength(0);
  });

  it("rejects an authorised target before update reaches Xero", async () => {
    const { service, adapter } = buildDraftService({ status: "AUTHORISED" });

    await expect(
      service.preview({
        operation: "update",
        resource: "invoice",
        targetId: "inv-1",
        payload: invoicePayload,
      }),
    ).rejects.toMatchObject({ code: "NOT_DRAFT" });
    expect(adapter.updateCalls).toHaveLength(0);
  });

  it("re-fetches and updates an unchanged DRAFT target", async () => {
    const { service, adapter } = buildDraftService({ status: "DRAFT" });
    const preview = await service.preview({
      operation: "update",
      resource: "invoice",
      targetId: "inv-1",
      payload: invoicePayload,
    });

    expect(adapter.getCalls).toEqual(["inv-1"]);
    expect(adapter.updateCalls).toHaveLength(0);

    const applied = await service.apply(preview.confirmationToken);

    expect(adapter.getCalls).toEqual(["inv-1", "inv-1"]);
    expect(adapter.updateCalls).toEqual([
      {
        id: "inv-1",
        payload: { ...invoicePayload, status: "DRAFT" },
      },
    ]);
    expect(applied).toMatchObject({ operation: "update", targetId: "inv-1" });
  });

  it("rejects a target authorised after preview before update", async () => {
    const { service, adapter } = buildDraftService({ status: "DRAFT" });
    const preview = await service.preview({
      operation: "update",
      resource: "invoice",
      targetId: "inv-1",
      payload: invoicePayload,
    });
    adapter.record = { ...adapter.record!, status: "AUTHORISED" };

    await expect(
      service.apply(preview.confirmationToken),
    ).rejects.toMatchObject({ code: "NOT_DRAFT" });
    expect(adapter.updateCalls).toHaveLength(0);
  });

  it("rejects a target changed after preview before update", async () => {
    const { service, adapter } = buildDraftService({ status: "DRAFT" });
    const preview = await service.preview({
      operation: "update",
      resource: "invoice",
      targetId: "inv-1",
      payload: invoicePayload,
    });
    adapter.record = { ...adapter.record!, version: "v2" };

    await expect(
      service.apply(preview.confirmationToken),
    ).rejects.toMatchObject({ code: "XERO_CONFLICT" });
    expect(adapter.updateCalls).toHaveLength(0);
  });

  it("re-fetches and deletes an unchanged DRAFT target", async () => {
    const { service, adapter } = buildDraftService({ status: "DRAFT" });
    const preview = await service.preview({
      operation: "delete",
      resource: "invoice",
      targetId: "inv-1",
    });

    expect(preview.payload).toBeUndefined();
    expect(adapter.deleteCalls).toHaveLength(0);

    await service.apply(preview.confirmationToken);

    expect(adapter.getCalls).toEqual(["inv-1", "inv-1"]);
    expect(adapter.deleteCalls).toEqual(["inv-1"]);
  });
});
