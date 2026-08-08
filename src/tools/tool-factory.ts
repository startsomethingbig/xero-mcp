import { McpServer } from "@modelcontextprotocol/server";

import { CreateTools } from "./create/index.js";
import { DeleteTools } from "./delete/index.js";
import { GetTools } from "./get/index.js";
import { ListTools } from "./list/index.js";
import { UpdateTools } from "./update/index.js";

export function ToolFactory(server: McpServer) {
  [DeleteTools, GetTools, CreateTools, ListTools, UpdateTools]
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
