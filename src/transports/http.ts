import {
  hostHeaderValidation,
  originValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";
import {
  createMcpHandler,
  type McpServerFactory,
} from "@modelcontextprotocol/server";
import { createServer, type Server } from "node:http";
import { createXeroMcpServer, type ServerDependencies } from "../mcp/server.js";

const LOCAL_HOSTNAMES = ["localhost", "127.0.0.1", "[::1]"];

function configuredHostnames(value: string | undefined): string[] {
  if (!value) return [];

  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => {
      try {
        return new URL(origin).hostname;
      } catch {
        return origin;
      }
    });
}

export function createHttpServer(dependencies: ServerDependencies): Server {
  const allowedHostnames = [
    ...LOCAL_HOSTNAMES,
    ...configuredHostnames(process.env.MCP_ALLOWED_ORIGINS),
  ];
  const validateHost = hostHeaderValidation(allowedHostnames);
  const validateOrigin = originValidation(allowedHostnames);
  const createServerForRequest: McpServerFactory = () =>
    createXeroMcpServer(dependencies);
  const mcpHandler = toNodeHandler(
    createMcpHandler(createServerForRequest, {
      legacy: "reject",
      responseMode: "json",
    }),
  );

  return createServer(async (request, response) => {
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
      !validateOrigin(request, response)
    ) {
      return;
    }

    await mcpHandler(request, response);
  });
}
