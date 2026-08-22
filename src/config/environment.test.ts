import { describe, expect, it } from "vitest";
import { loadEnvironment } from "./environment.js";

describe("loadEnvironment", () => {
  it("requires an explicit confirmation secret", () => {
    expect(() =>
      loadEnvironment({
        XERO_CLIENT_ID: "client",
        XERO_CLIENT_SECRET: "test-secret",
        XERO_TENANT_ID: "tenant",
      }),
    ).toThrow("XERO_CONFIRMATION_SECRET is required");
  });

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

function captureError(run: () => unknown): Error {
  try {
    run();
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected the call to throw");
}

const base = {
  XERO_CLIENT_ID: "client",
  XERO_CLIENT_SECRET: "test-secret",
  XERO_TENANT_ID: "tenant",
  XERO_CONFIRMATION_SECRET: "confirmation-secret",
};

describe("loadEnvironment numeric parsing", () => {
  it("treats an empty PORT as unset instead of binding port 0", () => {
    expect(loadEnvironment({ ...base, PORT: "" }).port).toBe(3000);
  });

  it.each(["abc", "1.5", "-1", "70000", "0x10"])(
    "rejects PORT=%s with a clear message",
    (value) => {
      expect(() => loadEnvironment({ ...base, PORT: value })).toThrow(
        /PORT must be an integer between 0 and 65535/,
      );
    },
  );

  it("allows an explicit PORT=0 so a test may bind an ephemeral port", () => {
    expect(loadEnvironment({ ...base, PORT: "0" }).port).toBe(0);
  });

  it("treats an empty confirmation TTL as unset", () => {
    expect(
      loadEnvironment({ ...base, XERO_CONFIRMATION_TTL_SECONDS: "" })
        .confirmationTtlSeconds,
    ).toBe(600);
  });

  it.each(["abc", "0", "-5", "1.5", "3601"])(
    "rejects XERO_CONFIRMATION_TTL_SECONDS=%s",
    (value) => {
      expect(() =>
        loadEnvironment({ ...base, XERO_CONFIRMATION_TTL_SECONDS: value }),
      ).toThrow(
        /XERO_CONFIRMATION_TTL_SECONDS must be an integer between 1 and 3600/,
      );
    },
  );

  it("bounds MCP_MAX_BODY_BYTES and defaults it to 1 MiB", () => {
    expect(loadEnvironment(base).maxBodyBytes).toBe(1_048_576);
    expect(
      loadEnvironment({ ...base, MCP_MAX_BODY_BYTES: "4096" }).maxBodyBytes,
    ).toBe(4096);
    expect(() =>
      loadEnvironment({ ...base, MCP_MAX_BODY_BYTES: "10" }),
    ).toThrow(
      /MCP_MAX_BODY_BYTES must be an integer between 1024 and 67108864/,
    );
  });
});

describe("loadEnvironment network settings", () => {
  it("binds to loopback unless MCP_BIND_HOST says otherwise", () => {
    expect(loadEnvironment(base).bindHost).toBe("127.0.0.1");
    expect(
      loadEnvironment({ ...base, MCP_BIND_HOST: " 10.0.0.5 " }).bindHost,
    ).toBe("10.0.0.5");
    expect(loadEnvironment({ ...base, MCP_BIND_HOST: "" }).bindHost).toBe(
      "127.0.0.1",
    );
  });

  it("requires MCP_AUTH_TOKEN only in http mode and never echoes it", () => {
    expect(() => loadEnvironment(base)).not.toThrow();
    expect(() => loadEnvironment(base, { mode: "stdio" })).not.toThrow();
    expect(() => loadEnvironment(base, { mode: "http" })).toThrow(
      "MCP_AUTH_TOKEN is required in http mode",
    );
    const shortToken = "short-but-still-secret";
    const failure = captureError(() =>
      loadEnvironment(
        { ...base, MCP_AUTH_TOKEN: shortToken },
        { mode: "http" },
      ),
    );
    expect(failure.message).toMatch(
      /MCP_AUTH_TOKEN must be at least 32 characters/,
    );
    expect(failure.message).not.toContain(shortToken);
    const token = "t".repeat(32);
    expect(
      loadEnvironment({ ...base, MCP_AUTH_TOKEN: token }, { mode: "http" })
        .authToken,
    ).toBe(token);
  });

  it("normalises allowlists to hostnames and keeps hosts and origins separate", () => {
    const environment = loadEnvironment({
      ...base,
      MCP_ALLOWED_HOSTS: "mcp.internal:8443, 10.1.2.3",
      MCP_ALLOWED_ORIGINS: "https://app.example.com, app2.example.com:3000",
    });
    expect(environment.allowedHosts).toEqual(["mcp.internal", "10.1.2.3"]);
    expect(environment.allowedOrigins).toEqual([
      "app.example.com",
      "app2.example.com",
    ]);
  });

  it("adds a non-wildcard bind host to the allowed hosts", () => {
    expect(
      loadEnvironment({ ...base, MCP_BIND_HOST: "10.0.0.5" }).allowedHosts,
    ).toEqual(["10.0.0.5"]);
    expect(
      loadEnvironment({ ...base, MCP_BIND_HOST: "0.0.0.0" }).allowedHosts,
    ).toEqual([]);
    expect(
      loadEnvironment({ ...base, MCP_BIND_HOST: "fd00::5" }).allowedHosts,
    ).toEqual(["[fd00::5]"]);
    expect(
      loadEnvironment({ ...base, MCP_BIND_HOST: "::1" }).allowedHosts,
    ).toEqual([]);
  });

  it.each([
    ["MCP_ALLOWED_HOSTS", "*"],
    ["MCP_ALLOWED_HOSTS", "https://a.example,*"],
    ["MCP_ALLOWED_ORIGINS", "*"],
    ["MCP_ALLOWED_ORIGINS", "*.example.com"],
    ["MCP_ALLOWED_ORIGINS", "https://"],
  ])("rejects %s=%s at startup", (key, value) => {
    expect(() => loadEnvironment({ ...base, [key]: value })).toThrow(
      new RegExp(`${key} entry .* is not a valid hostname`),
    );
  });
});
