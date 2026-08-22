import type { XeroEnvironment } from "../config/environment.js";

export function testEnvironment(
  overrides: Partial<XeroEnvironment> = {},
): XeroEnvironment {
  return {
    clientId: "client-id",
    clientSecret: "client-secret",
    tenantId: "tenant",
    port: 3000,
    confirmationTtlSeconds: 600,
    confirmationSecret: "confirmation-secret",
    bindHost: "127.0.0.1",
    allowedHosts: [],
    allowedOrigins: [],
    maxBodyBytes: 1_048_576,
    ...overrides,
  };
}
