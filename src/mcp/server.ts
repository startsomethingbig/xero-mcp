import { McpServer } from "@modelcontextprotocol/server";

import type { ConfirmationStore } from "../drafts/confirmation-store.js";
import type { DraftCommandService } from "../drafts/draft-command-service.js";
import type { XeroApi } from "../xero/client.js";

/**
 * Process-wide services shared by every MCP server instance. The HTTP
 * transport builds a fresh McpServer per request, so anything that must
 * survive between a preview and its apply (the confirmation store, the
 * draft service's pending commands) has to live here, built once in main().
 */
export interface ServerDependencies {
  readonly xeroApi: XeroApi;
  readonly confirmations: ConfirmationStore;
  readonly drafts: DraftCommandService;
}

export function createXeroMcpServer(
  dependencies: ServerDependencies,
): McpServer {
  void dependencies;

  return new McpServer(
    { name: "xero-mcp", version: "0.0.16" },
    { supportedProtocolVersions: ["2026-07-28"] },
  );
}
