import {
  hostHeaderValidation,
  originValidation,
  toNodeHandler,
  type NodeIncomingMessageLike,
} from "@modelcontextprotocol/node";
import {
  createMcpHandler,
  type McpServerFactory,
} from "@modelcontextprotocol/server";
import { createHash, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { createXeroMcpServer, type ServerDependencies } from "../mcp/server.js";

const LOCAL_HOSTNAMES = ["localhost", "127.0.0.1", "[::1]"];
const DEFAULT_MAX_BODY_BYTES = 1_048_576;
const BEARER_PATTERN = /^Bearer +(\S+) *$/i;

export interface HttpServerOptions {
  /** Shared secret every request must present as `Authorization: Bearer`. */
  authToken: string;
  /** Extra hostnames accepted in `Host` (loopback is always accepted). */
  allowedHosts?: readonly string[];
  /** Extra hostnames accepted in `Origin` (loopback is always accepted). */
  allowedOrigins?: readonly string[];
  /** Largest request body accepted, in bytes. */
  maxBodyBytes?: number;
  /** Receives transport-level errors the SDK reports. */
  onError?: (error: Error) => void;
}

function writeJsonRpcError(
  response: ServerResponse,
  status: number,
  message: string,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, {
    "Content-Type": "application/json",
    ...headers,
  });
  response.end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message },
      id: null,
    }),
  );
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Hostnames that can never be granted, whatever the configuration says. */
function withoutWildcards(hostnames: readonly string[]): string[] {
  return hostnames.filter((hostname) => hostname && !hostname.includes("*"));
}

function bearerGuard(
  authToken: string,
): (request: IncomingMessage, response: ServerResponse) => boolean {
  if (!authToken) {
    throw new Error("createHttpServer requires a non-empty authToken");
  }
  const expected = digest(authToken);

  return (request, response) => {
    const header = request.headers.authorization;
    const presented = typeof header === "string" && header.length > 0;
    const match = presented ? BEARER_PATTERN.exec(header) : null;
    if (match && timingSafeEqual(digest(match[1]!), expected)) {
      return true;
    }

    writeJsonRpcError(
      response,
      401,
      presented
        ? "Unauthorized: invalid bearer token"
        : "Unauthorized: missing bearer token",
      {
        "WWW-Authenticate": presented
          ? 'Bearer realm="xero-mcp", error="invalid_token"'
          : 'Bearer realm="xero-mcp"',
        Connection: "close",
      },
    );
    return false;
  };
}

/**
 * Read the request body with a hard byte cap. Resolves to "overflow" as soon
 * as the cap is exceeded without destroying the socket, so the caller can
 * still write a response.
 */
function readBodyCapped(
  request: IncomingMessage,
  maxBytes: number,
): Promise<Buffer | "overflow"> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let seen = 0;

    const onData = (chunk: Buffer) => {
      seen += chunk.length;
      if (seen > maxBytes) {
        request.off("data", onData);
        request.pause();
        resolve("overflow");
        return;
      }
      chunks.push(chunk);
    };

    request.on("data", onData);
    request.once("end", () => resolve(Buffer.concat(chunks)));
    request.once("error", reject);
    request.once("aborted", () => reject(new Error("request aborted")));
  });
}

function replayRequest(
  request: IncomingMessage,
  body: Buffer,
): NodeIncomingMessageLike {
  return {
    method: request.method,
    url: request.url,
    headers: request.headers,
    async *[Symbol.asyncIterator]() {
      if (body.length > 0) yield body;
    },
  };
}

export function createHttpServer(
  dependencies: ServerDependencies,
  options: HttpServerOptions,
): Server {
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const validateHost = hostHeaderValidation([
    ...LOCAL_HOSTNAMES,
    ...withoutWildcards(options.allowedHosts ?? []),
  ]);
  const validateOrigin = originValidation([
    ...LOCAL_HOSTNAMES,
    ...withoutWildcards(options.allowedOrigins ?? []),
  ]);
  const requireBearer = bearerGuard(options.authToken);
  const createServerForRequest: McpServerFactory = () =>
    createXeroMcpServer(dependencies);
  const handler = createMcpHandler(createServerForRequest, {
    legacy: "reject",
    responseMode: "json",
    ...(options.onError ? { onerror: options.onError } : {}),
  });
  const mcpHandler = toNodeHandler(
    handler,
    options.onError ? { onerror: options.onError } : undefined,
  );

  const server = createServer(async (request, response) => {
    if (request.url !== "/mcp") {
      response.writeHead(404).end();
      return;
    }

    if (request.method !== "POST") {
      response.writeHead(405, { Allow: "POST" }).end();
      return;
    }

    if (
      !validateHost(request, response) ||
      !validateOrigin(request, response) ||
      !requireBearer(request, response)
    ) {
      return;
    }

    const declaredLength = Number(request.headers["content-length"]);
    if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
      writeJsonRpcError(response, 413, "Payload Too Large", {
        Connection: "close",
      });
      return;
    }

    let body: Buffer | "overflow";
    try {
      body = await readBodyCapped(request, maxBodyBytes);
    } catch {
      response.destroy();
      return;
    }
    if (body === "overflow") {
      writeJsonRpcError(response, 413, "Payload Too Large", {
        Connection: "close",
      });
      return;
    }

    await mcpHandler(replayRequest(request, body), response);
  });

  server.once("close", () => {
    void handler.close();
  });

  return server;
}
