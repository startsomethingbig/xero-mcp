import { describe, expect, it } from "vitest";
import { loadEnvironment } from "./environment.js";

describe("loadEnvironment", () => {
  it("requires an explicit tenant and redacts secret values", () => {
    expect(() =>
      loadEnvironment({
        XERO_CLIENT_ID: "client",
        XERO_CLIENT_SECRET: "test-secret",
        XERO_CONFIRMATION_SECRET: "confirmation-secret",
      }),
    ).toThrow("XERO_TENANT_ID is required");

    expect(() =>
      loadEnvironment({
        XERO_CLIENT_ID: "client",
        XERO_CLIENT_SECRET: "test-secret",
        XERO_TENANT_ID: "tenant",
        XERO_CONFIRMATION_SECRET: "confirmation-secret",
      }),
    ).not.toThrow();
  });
});
