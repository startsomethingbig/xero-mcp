import type { McpServerFactory, Transport } from "@modelcontextprotocol/server";
import { serveStdio as serveMcpStdio } from "@modelcontextprotocol/server/stdio";

export async function serveStdio(
  createServer: McpServerFactory,
  transport?: Transport,
): Promise<void> {
  serveMcpStdio(createServer, {
    legacy: "reject",
    ...(transport ? { transport } : {}),
  });
}
