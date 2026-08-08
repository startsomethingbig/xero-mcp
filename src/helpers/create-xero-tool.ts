import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";

export const CreateXeroTool =
  <Args extends z.ZodRawShape>(
    name: string,
    description: string,
    schema: Args,
    handler: ToolDefinition<Args>["handler"],
  ): (() => ToolDefinition<Args>) =>
  () => ({
    name: name,
    description: description,
    schema: schema,
    handler: handler,
  });
