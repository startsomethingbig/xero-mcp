import type { AddressInfo } from "node:net";
import { request as httpRequest, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createHttpServer } from "./http.js";

type JsonRpcResponse = {
  result?: {
    _meta?: Record<string, unknown>;
  };
  error?: {
    code: number;
  };
};

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

async function listen(server: Server): Promise<URL> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return new URL(`http://127.0.0.1:${address.port}`);
}

async function fetchMcp(
  server: Server,
  message: { method: string; params: Record<string, unknown> },
  headers?: HeadersInit,
): Promise<{ status: number; headers: Headers; body: JsonRpcResponse }> {
  const baseUrl = await listen(server);
  const params = {
    ...message.params,
    _meta: {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": {},
      "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
      ...(message.params._meta as Record<string, unknown> | undefined),
    },
  };
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: message.method,
    params,
  });
  const requestHeaders = new Headers({
    "content-type": "application/json",
    "mcp-method": message.method,
    ...headers,
  });

  return new Promise((resolve, reject) => {
    const request = httpRequest(
      new URL("/mcp", baseUrl),
      {
        method: "POST",
        headers: Object.fromEntries(requestHeaders.entries()),
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const responseHeaders = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            if (value !== undefined) {
              responseHeaders.set(
                name,
                Array.isArray(value) ? value.join(", ") : value,
              );
            }
          }
          resolve({
            status: response.statusCode ?? 0,
            headers: responseHeaders,
            body: JSON.parse(
              Buffer.concat(chunks).toString(),
            ) as JsonRpcResponse,
          });
        });
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

describe("HTTP transport", () => {
  it("serves server/discover without a session", async () => {
    const response = await fetchMcp(createHttpServer({}), {
      method: "server/discover",
      params: {
        _meta: {
          "io.modelcontextprotocol/clientInfo": {
            name: "test",
            version: "1",
          },
        },
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.has("mcp-session-id")).toBe(false);
    expect(
      response.body.result?._meta?.["io.modelcontextprotocol/serverInfo"],
    ).toMatchObject({ name: "xero-mcp" });
  });

  it("rejects a legacy initialize request", async () => {
    const baseUrl = await listen(createHttpServer({}));
    const response = await fetch(new URL("/mcp", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {},
      }),
    });
    const body = (await response.json()) as JsonRpcResponse;

    expect(body.error?.code).toBe(-32022);
  });

  it("mounts MCP only on POST /mcp", async () => {
    const baseUrl = await listen(createHttpServer({}));

    const [wrongPath, wrongMethod] = await Promise.all([
      fetch(new URL("/other", baseUrl), { method: "POST" }),
      fetch(new URL("/mcp", baseUrl), { method: "GET" }),
    ]);

    expect(wrongPath.status).toBe(404);
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("allow")).toBe("POST");
  });

  it("rejects untrusted hosts and origins before MCP dispatch", async () => {
    const invalidHost = await fetchMcp(
      createHttpServer({}),
      { method: "server/discover", params: {} },
      { host: "attacker.example" },
    );
    const invalidOrigin = await fetchMcp(
      createHttpServer({}),
      { method: "server/discover", params: {} },
      { origin: "https://attacker.example" },
    );

    expect(invalidHost.status).toBe(403);
    expect(invalidOrigin.status).toBe(403);
  });

  it("allows configured origins in addition to localhost", async () => {
    const original = process.env.MCP_ALLOWED_ORIGINS;
    process.env.MCP_ALLOWED_ORIGINS = "https://app.example.com";

    try {
      const response = await fetchMcp(
        createHttpServer({}),
        { method: "server/discover", params: {} },
        { origin: "https://app.example.com" },
      );

      expect(response.status).toBe(200);
    } finally {
      if (original === undefined) {
        delete process.env.MCP_ALLOWED_ORIGINS;
      } else {
        process.env.MCP_ALLOWED_ORIGINS = original;
      }
    }
  });
});
