import { describe, expect, it, vi } from "vitest";

import { CreateTools } from "./create/index.js";
import { DeleteTools } from "./delete/index.js";
import { GetTools } from "./get/index.js";
import { ListTools } from "./list/index.js";
import { ToolFactory } from "./tool-factory.js";
import { UpdateTools } from "./update/index.js";

describe("ToolFactory", () => {
  it("registers legacy read tools without registering legacy writes", () => {
    const registerTool = vi.fn();

    ToolFactory({ registerTool } as never);

    const registeredNames = registerTool.mock.calls.map(([name]) => name);
    const readNames = [...GetTools, ...ListTools].map(
      (createTool) => createTool().name,
    );
    const writeNames = [...CreateTools, ...UpdateTools, ...DeleteTools].map(
      (createTool) => createTool().name,
    );

    expect(registeredNames).toEqual(readNames);
    expect(registeredNames).not.toEqual(expect.arrayContaining(writeNames));
  });
});
