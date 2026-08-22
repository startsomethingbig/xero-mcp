import type { McpServerFactory, Transport } from "@modelcontextprotocol/server";
import {
  serveStdio as serveMcpStdio,
  type StdioServerHandle,
} from "@modelcontextprotocol/server/stdio";

export interface StdioOptions {
  /** Alternative transport (tests); defaults to the process's stdio streams. */
  transport?: Transport;
  /** Receives transport and handler errors; the SDK otherwise swallows them. */
  onerror?: (error: Error) => void;
}

export function serveStdio(
  createServer: McpServerFactory,
  { transport, onerror }: StdioOptions = {},
): StdioServerHandle {
  return serveMcpStdio(createServer, {
    legacy: "reject",
    ...(transport ? { transport } : {}),
    ...(onerror ? { onerror } : {}),
  });
}
