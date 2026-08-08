import { McpServer } from "@modelcontextprotocol/server";

import { GetTools } from "./get/index.js";
import { ListTools } from "./list/index.js";

export function ToolFactory(server: McpServer) {
  [GetTools, ListTools]
    .flat()
    .map((createTool) => createTool())
    .forEach((tool) =>
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: tool.schema as never,
        },
        tool.handler as never,
      ),
    );
}
