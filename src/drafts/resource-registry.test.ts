import { describe, expect, it, vi } from "vitest";

import type { XeroApi } from "../xero/client.js";
import {
  DraftResourceRegistry,
  createDraftResourceRegistry,
} from "./resource-registry.js";

function fakeApi(): XeroApi {
  return {
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
}

describe("DraftResourceRegistry", () => {
  it("exposes only registered draft resources", () => {
    const registry = createDraftResourceRegistry(fakeApi());

    expect(registry.get("payment")).toBeUndefined();
    expect(registry.get("invoice")?.kind).toBe("invoice");
    expect(registry.get("credit_note")?.kind).toBe("credit_note");
    expect(registry.get("quote")?.kind).toBe("quote");
    expect(registry.get("purchase_order")?.kind).toBe("purchase_order");
  });

  it("rejects duplicate resource kinds instead of depending on order", () => {
    const adapter = {
      kind: "invoice",
      parsePayload: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getId: vi.fn(),
      getStatus: vi.fn(),
      getVersion: vi.fn(),
    };

    expect(() => new DraftResourceRegistry([adapter, adapter])).toThrow(
      "Duplicate draft resource: invoice",
    );
  });
});
