import type {
  CallToolResult,
  InputRequiredResult,
  ServerContext,
} from "@modelcontextprotocol/server";
import { z } from "zod";

type ToolHandler<Args extends z.ZodRawShape> = (
  args: z.infer<z.ZodObject<Args>>,
  context: ServerContext,
) =>
  | CallToolResult
  | InputRequiredResult
  | Promise<CallToolResult | InputRequiredResult>;

export interface ToolDefinition<Args extends z.ZodRawShape> {
  name: string;
  description: string;
  schema: Args;
  handler: ToolHandler<Args>;
}
