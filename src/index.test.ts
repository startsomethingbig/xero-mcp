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
  serveStdio: vi.fn(() => ({ close: vi.fn(async () => undefined) })),
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
    process.removeAllListeners("SIGINT");
    process.removeAllListeners("SIGTERM");
  });

  it("redacts a credential-bearing startup failure and exits 1", async () => {
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    mocks.createServerDependencies.mockImplementationOnce(() => {
      throw new Error("token request failed: Authorization: Bearer LEAKY");
    });

    await import("./index.js");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));

    const printed = stderr.mock.calls
      .map((call: unknown[]) => call.join(" "))
      .join("\n");
    expect(printed).not.toContain("LEAKY");
    expect(printed).toMatch(/xero-mcp/);
    exit.mockRestore();
  });

  it("wires stdio error reporting and shuts down on SIGINT", async () => {
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    await import("./index.js");
    await vi.waitFor(() => expect(mocks.serveStdio).toHaveBeenCalledOnce());

    expect(mocks.serveStdio).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ onerror: expect.any(Function) }),
    );
    const handle = mocks.serveStdio.mock.results[0]!.value as {
      close: ReturnType<typeof vi.fn>;
    };
    expect(process.listenerCount("SIGINT")).toBe(1);
    process.emit("SIGINT");
    await vi.waitFor(() => expect(handle.close).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    exit.mockRestore();
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
