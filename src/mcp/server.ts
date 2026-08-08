import { McpServer } from "@modelcontextprotocol/server";

export type ServerDependencies = Readonly<Record<string, never>>;

export function createXeroMcpServer(
  dependencies: ServerDependencies,
): McpServer {
  void dependencies;

  return new McpServer(
    { name: "xero-mcp", version: "0.0.16" },
    { supportedProtocolVersions: ["2026-07-28"] },
  );
}
