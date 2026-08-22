import { ConfirmationStore } from "../drafts/confirmation-store.js";
import { DraftCommandService } from "../drafts/draft-command-service.js";
import { createDraftResourceRegistry } from "../drafts/resource-registry.js";
import type { ServerDependencies } from "../mcp/server.js";
import type { XeroApi } from "../xero/client.js";

/** A XeroApi that records calls and never talks to Xero. */
export function fakeXeroApi(): XeroApi & { calls: string[] } {
  const calls: string[] = [];
  const reject = (name: string) => async () => {
    calls.push(name);
    throw new Error("fake XeroApi has no data");
  };
  return {
    calls,
    get: reject("get"),
    create: reject("create"),
    update: reject("update"),
    delete: reject("delete"),
  };
}

export function createTestDependencies(
  overrides: Partial<ServerDependencies> = {},
): ServerDependencies {
  const xeroApi = overrides.xeroApi ?? fakeXeroApi();
  const confirmations =
    overrides.confirmations ??
    new ConfirmationStore({ secret: "test-confirmation-secret" });
  const registry = createDraftResourceRegistry(xeroApi);
  const drafts =
    overrides.drafts ??
    new DraftCommandService({
      tenantId: "tenant",
      confirmations,
      getAdapter: (resource) => registry.get(resource),
    });
  return { xeroApi, confirmations, drafts };
}
