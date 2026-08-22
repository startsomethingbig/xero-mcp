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
    bindHost: "127.0.0.1",
    allowedHosts: ["mcp.internal"],
    allowedOrigins: ["app.example.com"],
    maxBodyBytes: 4096,
    authToken: "test-token-that-is-at-least-32-characters",
  })),
  createXeroMcpServer: vi.fn(() => ({})),
  createServerDependencies: vi.fn(() => ({ marker: "dependencies" })),
  listen: vi.fn((_port: number, _host: string, callback: () => void) =>
    callback(),
  ),
  createHttpServer: vi.fn(() => ({
    once: vi.fn(),
    listen: mocks.listen,
    address: () => ({ address: "127.0.0.1", family: "IPv4", port: 3000 }),
  })),
  serveStdio: vi.fn(async () => undefined),
}));

vi.mock("dotenv", () => ({
  default: { config: mocks.dotenvConfig },
}));
vi.mock("./config/environment.js", () => ({
  loadEnvironment: mocks.loadEnvironment,
}));
vi.mock("./mcp/dependencies.js", () => ({
  createServerDependencies: mocks.createServerDependencies,
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
  let stderr: ReturnType<typeof vi.spyOn>;
  let stdout: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.argv = ["node", "index.ts", "stdio"];
    stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    process.argv = originalArgv;
    stderr.mockRestore();
    stdout.mockRestore();
  });

  it("loads http-mode configuration and binds only to the configured host", async () => {
    process.argv = ["node", "index.ts", "http"];
    await import("./index.js");
    await vi.waitFor(() => expect(mocks.listen).toHaveBeenCalledOnce());

    expect(mocks.loadEnvironment).toHaveBeenCalledWith(process.env, {
      mode: "http",
    });
    expect(mocks.createServerDependencies).toHaveBeenCalledOnce();
    expect(mocks.createHttpServer).toHaveBeenCalledWith(
      mocks.createServerDependencies.mock.results[0]!.value,
      expect.objectContaining({
        authToken: "test-token-that-is-at-least-32-characters",
        allowedHosts: ["mcp.internal"],
        allowedOrigins: ["app.example.com"],
        maxBodyBytes: 4096,
      }),
    );
    expect(mocks.listen).toHaveBeenCalledWith(
      3000,
      "127.0.0.1",
      expect.any(Function),
    );
  });

  it("announces the bound address on stderr, never stdout", async () => {
    process.argv = ["node", "index.ts", "http"];
    await import("./index.js");
    await vi.waitFor(() => expect(mocks.listen).toHaveBeenCalledOnce());

    expect(stderr).toHaveBeenCalledWith(
      "xero-mcp http listening on http://127.0.0.1:3000/mcp",
    );
    expect(stdout).not.toHaveBeenCalled();
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
