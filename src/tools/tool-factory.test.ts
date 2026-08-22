import { describe, expect, it, vi } from "vitest";

import { GetTools } from "./get/index.js";
import { ListTools } from "./list/index.js";
import { ToolFactory } from "./tool-factory.js";

const WRITE_TOOL_PATTERN = /^(create|update|delete|approve|revert|void|pay|submit|authorise)-/i;

describe("ToolFactory", () => {
  it("registers only the read tools", () => {
    const registerTool = vi.fn();

    ToolFactory({ registerTool } as never);

    const registeredNames = registerTool.mock.calls.map(([name]) => name);
    const readNames = [...GetTools, ...ListTools].map(
      (createTool) => createTool().name,
    );

    expect(registeredNames).toEqual(readNames);
    expect(registeredNames.filter((n) => WRITE_TOOL_PATTERN.test(n))).toEqual(
      [],
    );
  });
});
