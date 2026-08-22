import type { AddressInfo } from "node:net";
import { request as httpRequest, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createXeroMcpServer } from "../mcp/server.js";
import { createHttpServer, type HttpServerOptions } from "./http.js";

vi.mock("../mcp/server.js", { spy: true });

type JsonRpcResponse = {
  result?: {
    _meta?: Record<string, unknown>;
  };
  error?: {
    code: number;
    message?: string;
  };
  id?: unknown;
};

type HttpResult = {
  status: number;
  headers: Headers;
  body: JsonRpcResponse;
};

const TOKEN = "test-token-that-is-at-least-32-characters";
const auth = { authorization: `Bearer ${TOKEN}` };
const discover = { method: "server/discover", params: {} };

const servers: Server[] = [];

afterEach(async () => {
  vi.mocked(createXeroMcpServer).mockClear();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.closeAllConnections();
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

function server(options: Partial<HttpServerOptions> = {}): Server {
  return createHttpServer({}, { authToken: TOKEN, ...options });
}

async function listen(server: Server): Promise<URL> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return new URL(`http://127.0.0.1:${address.port}`);
}

function envelope(message: {
  method: string;
  params: Record<string, unknown>;
}) {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: message.method,
    params: {
      ...message.params,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {},
        "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
        ...(message.params._meta as Record<string, unknown> | undefined),
      },
    },
  });
}

function postRaw(
  baseUrl: URL,
  body: string | Buffer,
  headers: Record<string, string>,
  write?: (request: ReturnType<typeof httpRequest>) => void,
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      new URL("/mcp", baseUrl),
      { method: "POST", headers },
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
          const text = Buffer.concat(chunks).toString();
          resolve({
            status: response.statusCode ?? 0,
            headers: responseHeaders,
            body: text ? (JSON.parse(text) as JsonRpcResponse) : {},
          });
        });
      },
    );
    request.on("error", reject);
    if (write) {
      write(request);
    } else {
      request.end(body);
    }
  });
}

function postMcp(
  baseUrl: URL,
  message: { method: string; params: Record<string, unknown> },
  headers: Record<string, string> = {},
): Promise<HttpResult> {
  return postRaw(baseUrl, envelope(message), {
    "content-type": "application/json",
    "mcp-method": message.method,
    ...headers,
  });
}

describe("HTTP transport", () => {
  it("serves server/discover without a session", async () => {
    const response = await postMcp(
      await listen(server()),
      {
        method: "server/discover",
        params: {
          _meta: {
            "io.modelcontextprotocol/clientInfo": {
              name: "test",
              version: "1",
            },
          },
        },
      },
      auth,
    );

    expect(response.status).toBe(200);
    expect(response.headers.has("mcp-session-id")).toBe(false);
    expect(
      response.body.result?._meta?.["io.modelcontextprotocol/serverInfo"],
    ).toMatchObject({ name: "xero-mcp" });
  });

  it("rejects a legacy initialize request", async () => {
    const baseUrl = await listen(server());
    const response = await fetch(new URL("/mcp", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
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
    const baseUrl = await listen(server());

    const [wrongPath, wrongMethod] = await Promise.all([
      fetch(new URL("/other", baseUrl), { method: "POST" }),
      fetch(new URL("/mcp", baseUrl), { method: "GET" }),
    ]);

    expect(wrongPath.status).toBe(404);
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("allow")).toBe("POST");
  });

  it("rejects untrusted hosts and origins before MCP dispatch", async () => {
    const baseUrl = await listen(server());
    const invalidHost = await postMcp(baseUrl, discover, {
      ...auth,
      host: "attacker.example",
    });
    const invalidOrigin = await postMcp(baseUrl, discover, {
      ...auth,
      origin: "https://attacker.example",
    });

    expect(invalidHost.status).toBe(403);
    expect(invalidOrigin.status).toBe(403);
  });

  it("allows configured origins in addition to localhost", async () => {
    const baseUrl = await listen(
      server({ allowedOrigins: ["app.example.com"] }),
    );
    const response = await postMcp(baseUrl, discover, {
      ...auth,
      origin: "https://app.example.com",
    });

    expect(response.status).toBe(200);
  });

  it("does not let an allowed origin widen the Host allowlist", async () => {
    const baseUrl = await listen(
      server({ allowedOrigins: ["app.example.com"] }),
    );
    const response = await postMcp(baseUrl, discover, {
      ...auth,
      host: "app.example.com",
    });

    expect(response.status).toBe(403);
  });

  it("allows configured hosts without trusting them as origins", async () => {
    const baseUrl = await listen(server({ allowedHosts: ["mcp.internal"] }));
    const allowedHost = await postMcp(baseUrl, discover, {
      ...auth,
      host: "mcp.internal",
    });
    const sameNameAsOrigin = await postMcp(baseUrl, discover, {
      ...auth,
      origin: "https://mcp.internal",
    });

    expect(allowedHost.status).toBe(200);
    expect(sameNameAsOrigin.status).toBe(403);
  });

  it("ignores a literal wildcard even if one reaches the allowlist", async () => {
    const baseUrl = await listen(server({ allowedHosts: ["*"] }));
    const response = await postMcp(baseUrl, discover, { ...auth, host: "*" });

    expect(response.status).toBe(403);
  });

  describe("bearer authentication", () => {
    it("rejects requests without a bearer token with 401", async () => {
      const response = await postMcp(await listen(server()), discover);

      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe(
        'Bearer realm="xero-mcp"',
      );
      expect(response.headers.get("content-type")).toBe("application/json");
      expect(response.body).toEqual({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: expect.stringMatching(/bearer token/i),
        },
        id: null,
      });
    });

    it.each([
      ["a wrong token", `Bearer ${TOKEN.slice(0, -1)}x`],
      ["a longer token with the right prefix", `Bearer ${TOKEN}extra`],
      [
        "a non-bearer scheme",
        `Basic ${Buffer.from(`x:${TOKEN}`).toString("base64")}`,
      ],
      ["extra parameters", `Bearer ${TOKEN} extra`],
    ])("rejects %s with 401 invalid_token", async (_label, authorization) => {
      const response = await postMcp(await listen(server()), discover, {
        authorization,
      });

      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain(
        'error="invalid_token"',
      );
    });

    it("accepts the configured bearer token case-insensitively on the scheme", async () => {
      const response = await postMcp(await listen(server()), discover, {
        authorization: `bearer ${TOKEN}`,
      });

      expect(response.status).toBe(200);
    });

    it("checks host and origin before authentication", async () => {
      const response = await postMcp(await listen(server()), discover, {
        host: "attacker.example",
      });

      expect(response.status).toBe(403);
    });

    it("never builds an MCP server for an unauthenticated request", async () => {
      const baseUrl = await listen(server());
      await postMcp(baseUrl, discover);
      expect(createXeroMcpServer).not.toHaveBeenCalled();

      await postMcp(baseUrl, discover, auth);
      expect(createXeroMcpServer).toHaveBeenCalledTimes(1);
    });
  });

  describe("request body limit", () => {
    const maxBodyBytes = 2048;

    it("rejects a declared oversize body with 413 before reading it", async () => {
      const baseUrl = await listen(server({ maxBodyBytes }));
      const response = await postRaw(
        baseUrl,
        "",
        {
          "content-type": "application/json",
          "content-length": String(maxBodyBytes + 1),
          ...auth,
        },
        (request) => {
          // Send headers only; the server must answer without waiting for the body.
          request.flushHeaders();
          request.on("response", (response) =>
            response.once("end", () => request.destroy()),
          );
        },
      );

      expect(response.status).toBe(413);
      expect(response.body).toMatchObject({ error: { code: -32000 } });
      expect(createXeroMcpServer).not.toHaveBeenCalled();
    });

    it("rejects a chunked oversize body with 413", async () => {
      const baseUrl = await listen(server({ maxBodyBytes }));
      const response = await postRaw(
        baseUrl,
        "",
        {
          "content-type": "application/json",
          "transfer-encoding": "chunked",
          ...auth,
        },
        (request) => {
          request.write("{".padEnd(maxBodyBytes, " "));
          request.write(" ".repeat(64));
          request.end("}");
        },
      );

      expect(response.status).toBe(413);
      expect(createXeroMcpServer).not.toHaveBeenCalled();
    });

    it("passes a body exactly at the limit through to MCP", async () => {
      const baseUrl = await listen(server({ maxBodyBytes }));
      const body = envelope(discover);
      const padded =
        body.slice(0, -1) + " ".repeat(maxBodyBytes - body.length) + "}";
      expect(Buffer.byteLength(padded)).toBe(maxBodyBytes);

      const response = await postRaw(baseUrl, padded, {
        "content-type": "application/json",
        "mcp-method": "server/discover",
        ...auth,
      });

      expect(response.status).toBe(200);
    });

    it("still lets the SDK reject malformed JSON", async () => {
      const baseUrl = await listen(server({ maxBodyBytes }));
      const response = await postRaw(baseUrl, "{not json", {
        "content-type": "application/json",
        ...auth,
      });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ error: { code: -32700 } });
    });
  });
});
