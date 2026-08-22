import { describe, expect, it, vi } from "vitest";

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
  readonly parseCalls: Array<"create" | "update"> = [];

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

  parsePayload(input: unknown, operation: "create" | "update"): InvoicePayload {
    this.parseCalls.push(operation);
    if (!input || typeof input !== "object") throw new TypeError("payload");
    const payload = input as Partial<InvoicePayload>;
    if (typeof payload.reference !== "string") throw new TypeError("reference");
    if (operation === "create" && payload.reference.length === 0) {
      throw new TypeError("reference is required to create");
    }
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
    return record.version ? { value: record.version } : undefined;
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
    confirmations,
    clock,
    setNow(iso: string) {
      now = new Date(iso);
    },
  };
}

function previewCreate(
  service: DraftCommandService,
  reference = "August services",
) {
  return service.preview({
    operation: "create",
    resource: "invoice",
    payload: { reference },
  });
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
        idempotencyKey: expect.stringMatching(/^[0-9a-f]{64}$/),
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
  it("rejects an unknown operation at preview before any token is minted", async () => {
    const { service, adapter, confirmations } = buildDraftService({
      status: "DRAFT",
    });
    const mint = vi.spyOn(confirmations, "mint");

    await expect(
      service.preview({
        operation: "purge" as never,
        resource: "invoice",
        targetId: "inv-1",
      }),
    ).rejects.toThrow(/operation/);

    expect(mint).not.toHaveBeenCalled();
    expect(adapter.deleteCalls).toHaveLength(0);
  });

  it("rejects malformed tokens as invalid without touching the store", async () => {
    const { service, confirmations } = buildDraftService();
    const hashToken = vi.spyOn(confirmations, "hashToken");

    await expect(service.apply(123 as never)).rejects.toMatchObject({
      code: "CONFIRMATION_INVALID",
    });
    await expect(service.apply("x".repeat(1_000_000))).rejects.toMatchObject({
      code: "CONFIRMATION_INVALID",
    });
    await expect(service.apply("")).rejects.toMatchObject({
      code: "CONFIRMATION_INVALID",
    });

    expect(hashToken).not.toHaveBeenCalled();
  });

  it("does not consume a token it did not mint", async () => {
    const owner = buildDraftService();
    const stranger = new DraftCommandService({
      tenantId: "tenant-1",
      clock: owner.clock,
      confirmations: owner.confirmations,
      getAdapter: () => undefined,
    });
    const preview = await previewCreate(owner.service);

    await expect(
      stranger.apply(preview.confirmationToken),
    ).rejects.toMatchObject({ code: "CONFIRMATION_INVALID" });
    await expect(
      owner.service.apply(preview.confirmationToken),
    ).resolves.toMatchObject({ operation: "create" });
  });

  it("refuses to preview an update or delete whose target has no version", async () => {
    const { service, adapter } = buildDraftService({ version: "" });

    await expect(
      service.preview({
        operation: "delete",
        resource: "invoice",
        targetId: "inv-1",
      }),
    ).rejects.toMatchObject({ code: "VERSION_UNAVAILABLE" });

    expect(adapter.deleteCalls).toHaveLength(0);
  });

  it("refuses to apply when the re-fetched target has lost its version", async () => {
    const { service, adapter } = buildDraftService({ status: "DRAFT" });
    const preview = await service.preview({
      operation: "delete",
      resource: "invoice",
      targetId: "inv-1",
    });
    adapter.record!.version = "";

    await expect(
      service.apply(preview.confirmationToken),
    ).rejects.toMatchObject({ code: "VERSION_UNAVAILABLE" });

    expect(adapter.deleteCalls).toHaveLength(0);
  });

  it("passes the operation to the adapter so creates are validated strictly at preview", async () => {
    const { service, adapter, confirmations } = buildDraftService({
      status: "DRAFT",
    });
    const mint = vi.spyOn(confirmations, "mint");

    await expect(previewCreate(service, "")).rejects.toThrow(/required/);
    expect(mint).not.toHaveBeenCalled();

    await service.preview({
      operation: "update",
      resource: "invoice",
      targetId: "inv-1",
      payload: { reference: "" },
    });
    expect(adapter.parseCalls).toEqual(["create", "update"]);
  });

  it("drops pending state when an apply fails", async () => {
    const { service, adapter } = buildDraftService({ status: "DRAFT" });
    const preview = await service.preview({
      operation: "update",
      resource: "invoice",
      targetId: "inv-1",
      payload: invoicePayload,
    });
    adapter.record!.status = "AUTHORISED";

    await expect(
      service.apply(preview.confirmationToken),
    ).rejects.toMatchObject({ code: "NOT_DRAFT" });

    expect(service.pendingCount).toBe(0);
    expect(adapter.updateCalls).toHaveLength(0);
  });

  it("sweeps expired previews so abandoned payloads are not retained", async () => {
    const { service, setNow } = buildDraftService();

    await previewCreate(service);
    await previewCreate(service, "Second");
    expect(service.pendingCount).toBe(2);

    setNow("2026-08-09T00:10:01.000Z");
    await previewCreate(service, "Third");

    expect(service.pendingCount).toBe(1);
  });

  it("derives the create idempotency key from the operation, not the token", async () => {
    const { service, adapter } = buildDraftService();

    const first = await previewCreate(service);
    await service.apply(first.confirmationToken);
    const second = await previewCreate(service);
    await service.apply(second.confirmationToken);
    const other = await previewCreate(service, "Different");
    await service.apply(other.confirmationToken);

    expect(first.confirmationToken).not.toBe(second.confirmationToken);
    expect(adapter.createCalls[0]!.idempotencyKey).toBe(
      adapter.createCalls[1]!.idempotencyKey,
    );
    expect(adapter.createCalls[2]!.idempotencyKey).not.toBe(
      adapter.createCalls[0]!.idempotencyKey,
    );
  });
});
