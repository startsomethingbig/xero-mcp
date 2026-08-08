import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dotenvConfig: vi.fn(),
  loadEnvironment: vi.fn(() => ({
    clientId: "client-id",
    clientSecret: "client-secret",
    tenantId: "tenant-id",
    port: 3000,
    confirmationTtlSeconds: 600,
    confirmationSecret: "confirmation-secret",
  })),
  createXeroMcpServer: vi.fn(() => ({})),
  createHttpServer: vi.fn(),
  serveStdio: vi.fn(async () => undefined),
}));

vi.mock("dotenv", () => ({
  default: { config: mocks.dotenvConfig },
}));
vi.mock("./config/environment.js", () => ({
  loadEnvironment: mocks.loadEnvironment,
}));
vi.mock("./mcp/server.js", () => ({
  createXeroMcpServer: mocks.createXeroMcpServer,
}));
vi.mock("./transports/http.js", () => ({
  createHttpServer: mocks.createHttpServer,
}));
vi.mock("./transports/stdio.js", () => ({
  serveStdio: mocks.serveStdio,
}));

describe("CLI environment bootstrap", () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.argv = ["node", "index.ts", "stdio"];
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  it("loads dotenv once before validating the environment", async () => {
    await import("./index.js");
    await vi.waitFor(() => expect(mocks.serveStdio).toHaveBeenCalledOnce());

    expect(mocks.dotenvConfig).toHaveBeenCalledOnce();
    expect(mocks.dotenvConfig.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.loadEnvironment.mock.invocationCallOrder[0]!,
    );
  });
});
