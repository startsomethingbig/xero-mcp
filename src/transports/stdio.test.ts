import {
  InMemoryTransport,
  type JSONRPCMessage,
  type McpServerFactory,
} from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { createXeroMcpServer } from "../mcp/server.js";
import { createTestDependencies } from "../test/dependencies.js";
import { serveStdio } from "./stdio.js";

function nextMessage(transport: InMemoryTransport): Promise<JSONRPCMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Timed out waiting for stdio response")),
      1_000,
    );
    transport.onmessage = (message) => {
      clearTimeout(timeout);
      resolve(message);
    };
  });
}

describe("stdio transport", () => {
  it("serves modern discovery from the supplied server factory", async () => {
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const factory: McpServerFactory = () =>
      createXeroMcpServer(createTestDependencies());
    const response = nextMessage(clientTransport);

    await clientTransport.start();
    await serveStdio(factory, serverTransport);
    await clientTransport.send({
      jsonrpc: "2.0",
      id: 1,
      method: "server/discover",
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
        },
      },
    });

    expect(await response).toMatchObject({
      result: {
        _meta: {
          "io.modelcontextprotocol/serverInfo": { name: "xero-mcp" },
        },
      },
    });
  });

  it("rejects legacy initialization", async () => {
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const response = nextMessage(clientTransport);

    await clientTransport.start();
    await serveStdio(
      () => createXeroMcpServer(createTestDependencies()),
      serverTransport,
    );
    await clientTransport.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    });

    expect(await response).toMatchObject({ error: { code: -32022 } });
  });
});
