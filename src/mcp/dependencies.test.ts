import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { fakeXeroApi } from "../test/dependencies.js";
import { testEnvironment } from "../test/environment.js";
import { createServerDependencies } from "./dependencies.js";

describe("createServerDependencies", () => {
  it("builds one confirmation store shared by the draft service", async () => {
    const dependencies = createServerDependencies(
      testEnvironment(),
      fakeXeroApi(),
    );

    const preview = await dependencies.drafts.preview({
      operation: "create",
      resource: "invoice",
      payload: {
        contactId: "contact-1",
        type: "ACCREC",
        lineItems: [
          {
            description: "Consulting",
            quantity: 1,
            unitAmount: 100,
            accountCode: "200",
            taxType: "OUTPUT",
          },
        ],
      },
    });

    await expect(
      dependencies.confirmations.consume(preview.confirmationToken, {}),
    ).resolves.toMatchObject({ operation: "create", resource: "invoice" });
  });

  it("keys confirmation hashes with XERO_CONFIRMATION_SECRET", () => {
    const environment = testEnvironment({ confirmationSecret: "s3cret" });
    const dependencies = createServerDependencies(environment, fakeXeroApi());

    expect(dependencies.confirmations.hashToken("token")).toBe(
      createHmac("sha256", "s3cret").update("token").digest("hex"),
    );
  });
});
