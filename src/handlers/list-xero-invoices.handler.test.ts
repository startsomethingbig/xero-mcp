import { afterEach, describe, expect, it, vi } from "vitest";

import { xeroClient } from "../clients/xero-client.js";
import { listXeroInvoices } from "./list-xero-invoices.handler.js";

describe("listXeroInvoices", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not return bearer credentials from an authentication error", async () => {
    vi.spyOn(xeroClient, "authenticate").mockRejectedValue(
      new Error("Authorization: Bearer handler-secret"),
    );

    const response = await listXeroInvoices();

    expect(response).toMatchObject({
      result: null,
      isError: true,
      error: "An error occurred while communicating with Xero.",
    });
    expect(response.error).not.toContain("Bearer");
    expect(response.error).not.toContain("handler-secret");
  });
});
