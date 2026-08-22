import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  ConfirmationStore,
  type ConfirmationInput,
} from "./confirmation-store.js";

const confirmation: ConfirmationInput = {
  operation: "update",
  resource: "invoice",
  canonicalPayloadHash: "payload-hash",
  tenantId: "tenant-1",
  targetId: "invoice-1",
  targetVersion: { value: "version-1" },
  expiresAt: "2026-08-09T00:10:00.000Z",
};

function buildStore() {
  let now = new Date("2026-08-09T00:00:00.000Z");
  const store = new ConfirmationStore({
    secret: "test-secret",
    clock: () => now,
    randomBytes: (size) => new Uint8Array(size).fill(0xab),
  });

  return {
    store,
    setNow(iso: string) {
      now = new Date(iso);
    },
  };
}

describe("ConfirmationStore", () => {
  it("mints an opaque token from exactly 32 random bytes", async () => {
    const { store } = buildStore();

    const token = await store.mint(confirmation);

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(token).not.toContain("invoice");
  });

  it("returns only the token hash and bindings when consumed", async () => {
    const { store } = buildStore();
    const token = await store.mint(confirmation);

    const record = await store.consume(token, confirmation);

    expect(record).toEqual({
      tokenHash: createHmac("sha256", "test-secret")
        .update(token)
        .digest("hex"),
      ...confirmation,
      consumedAt: "2026-08-09T00:00:00.000Z",
    });
    expect(JSON.stringify(record)).not.toContain(token);
  });

  it("atomically accepts a token only once", async () => {
    const { store } = buildStore();
    const token = await store.mint(confirmation);

    const results = await Promise.allSettled([
      store.consume(token, confirmation),
      store.consume(token, confirmation),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.find(({ status }) => status === "rejected")).toMatchObject({
      reason: { code: "CONFIRMATION_USED" },
    });
  });

  it("rejects an expired token", async () => {
    const { store, setNow } = buildStore();
    const token = await store.mint(confirmation);
    setNow("2026-08-09T00:10:00.001Z");

    await expect(store.consume(token, confirmation)).rejects.toMatchObject({
      code: "CONFIRMATION_EXPIRED",
    });
  });

  it("rejects a tampered token", async () => {
    const { store } = buildStore();
    const token = await store.mint(confirmation);
    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;

    await expect(store.consume(tampered, confirmation)).rejects.toMatchObject({
      code: "CONFIRMATION_INVALID",
    });
  });

  it.each([
    ["operation", { operation: "delete" }],
    ["resource", { resource: "credit_note" }],
    ["payload", { canonicalPayloadHash: "different-payload-hash" }],
    ["tenant", { tenantId: "tenant-2" }],
    ["target", { targetId: "invoice-2" }],
    ["absent target", { targetId: undefined }],
    ["version", { targetVersion: { value: "version-2" } }],
    ["absent version", { targetVersion: undefined }],
  ] as const)("rejects a %s-mismatched token", async (_name, mismatch) => {
    const { store } = buildStore();
    const token = await store.mint(confirmation);

    await expect(
      store.consume(token, { ...confirmation, ...mismatch }),
    ).rejects.toMatchObject({ code: "CONFIRMATION_MISMATCH" });
  });
});

describe("ConfirmationStore secret", () => {
  it("keys token hashes with the configured secret", async () => {
    const randomBytes = (size: number) => new Uint8Array(size).fill(0x11);
    const storeA = new ConfirmationStore({ secret: "secret-a", randomBytes });
    const storeB = new ConfirmationStore({ secret: "secret-b", randomBytes });

    const tokenA = await storeA.mint(confirmation);

    expect(storeA.hashToken(tokenA)).not.toBe(storeB.hashToken(tokenA));
    await expect(storeB.consume(tokenA, {})).rejects.toMatchObject({
      code: "CONFIRMATION_INVALID",
    });
  });

  it("refuses an empty secret", () => {
    expect(() => new ConfirmationStore({ secret: "" })).toThrow(/secret/i);
  });
});

describe("ConfirmationStore housekeeping", () => {
  it("sweeps expired records when minting", async () => {
    let now = new Date("2026-08-09T00:00:00.000Z");
    let counter = 0;
    const store = new ConfirmationStore({
      secret: "test-secret",
      clock: () => now,
      randomBytes: (size) => new Uint8Array(size).fill(++counter),
    });
    const setNow = (iso: string) => {
      now = new Date(iso);
    };

    await store.mint(confirmation);
    await store.mint({ ...confirmation, targetId: "invoice-2" });
    expect(store.size).toBe(2);

    setNow("2026-08-09T00:10:00.000Z");
    await store.mint({
      ...confirmation,
      expiresAt: "2026-08-09T01:00:00.000Z",
    });

    expect(store.size).toBe(1);
  });

  it("drops consumed records once they expire", async () => {
    const { store, setNow } = buildStore();
    const token = await store.mint(confirmation);
    await store.consume(token, {});
    expect(store.size).toBe(1);

    setNow("2026-08-09T00:10:00.000Z");
    await expect(store.consume(token, {})).rejects.toMatchObject({
      code: "CONFIRMATION_INVALID",
    });
    expect(store.size).toBe(0);
  });

  it("caps the number of live records", async () => {
    const store = new ConfirmationStore({
      secret: "test-secret",
      maxRecords: 2,
      clock: () => new Date("2026-08-09T00:00:00.000Z"),
    });

    await store.mint(confirmation);
    await store.mint(confirmation);
    await expect(store.mint(confirmation)).rejects.toThrow(
      /too many pending confirmations/i,
    );
  });

  it("reports token state without consuming it", async () => {
    const { store, setNow } = buildStore();
    const token = await store.mint(confirmation);

    expect(store.inspect("not-a-token")).toBe("unknown");
    expect(store.inspect(token)).toBe("live");
    await store.consume(token, {});
    expect(store.inspect(token)).toBe("consumed");
    setNow("2026-08-09T00:10:00.000Z");
    expect(store.inspect(token)).toBe("expired");
  });
});
