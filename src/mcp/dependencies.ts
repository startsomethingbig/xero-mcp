import type { XeroEnvironment } from "../config/environment.js";
import { ConfirmationStore } from "../drafts/confirmation-store.js";
import { DraftCommandService } from "../drafts/draft-command-service.js";
import { createDraftResourceRegistry } from "../drafts/resource-registry.js";
import { createXeroApi, type XeroApi } from "../xero/client.js";
import type { ServerDependencies } from "./server.js";

/** Build the shared service graph exactly once per process. */
export function createServerDependencies(
  environment: XeroEnvironment,
  xeroApi: XeroApi = createXeroApi(environment),
): ServerDependencies {
  const confirmations = new ConfirmationStore({
    secret: environment.confirmationSecret,
  });
  const registry = createDraftResourceRegistry(xeroApi);
  const drafts = new DraftCommandService({
    tenantId: environment.tenantId,
    confirmationTtlSeconds: environment.confirmationTtlSeconds,
    confirmations,
    getAdapter: (resource) => registry.get(resource),
  });

  return { xeroApi, confirmations, drafts };
}
