import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";

import { serveStdio } from "../transports/stdio.js";
import { createXeroMcpServer } from "./server.js";

const WRITE_TOOL_PATTERN = /^(create|update|delete|approve|revert|void|pay|submit|authorise)-/i;

async function listToolNames(): Promise<string[]> {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await serveStdio(() => createXeroMcpServer({}), serverTransport);

  const client = new Client(
    { name: "test", version: "1" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  await client.connect(clientTransport);
  try {
    const { tools } = await client.listTools();
    return tools.map((tool) => tool.name).sort();
  } finally {
    await client.close();
  }
}

describe("createXeroMcpServer tool catalogue", () => {
  it("exposes exactly the reviewed tool set", async () => {
    // Any change to this list is a deliberate, reviewed change to the attack surface.
    expect(await listToolNames()).toEqual([]);
  });

  it("never exposes a direct mutation tool", async () => {
    const names = await listToolNames();
    expect(names.filter((name) => WRITE_TOOL_PATTERN.test(name))).toEqual([]);
  });
});
