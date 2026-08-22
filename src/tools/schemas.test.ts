import { describe, expect, it } from "vitest";
import { z } from "zod";

import { GetTools } from "./get/index.js";
import { ListTools } from "./list/index.js";

const tools = [...GetTools, ...ListTools].map((create) => create());

type Case = { tool: string; field: string; schema: z.ZodTypeAny };

function fields(match: (name: string) => boolean): Case[] {
  return tools.flatMap((tool) =>
    Object.entries(tool.schema)
      .filter(([name]) => match(name))
      .map(([field, schema]) => ({
        tool: tool.name,
        field,
        schema: schema as z.ZodTypeAny,
      })),
  );
}

const idFields = fields((name) => /id$|ids$/i.test(name));
const pageFields = fields((name) => name === "page");
const dateFields = fields((name) => /date$|after$/i.test(name));
const textFilterFields = fields((name) =>
  /^(searchTerm|reference|invoiceNumber|invoiceNumbers|quoteNumber)$/.test(
    name,
  ),
);
const periodFields = fields((name) => name === "periods");

function reject(schema: z.ZodTypeAny, value: unknown) {
  return schema.safeParse(value).success === false;
}

describe("read tool input schemas", () => {
  it("covers every id, page, date, filter, and period field", () => {
    expect(idFields.length).toBeGreaterThanOrEqual(14);
    expect(pageFields.length).toBeGreaterThanOrEqual(8);
    expect(dateFields.length).toBeGreaterThanOrEqual(10);
    expect(textFilterFields.length).toBeGreaterThanOrEqual(5);
    expect(periodFields.length).toBe(2);
  });

  it.each(idFields)("$tool.$field accepts only UUIDs", ({ field, schema }) => {
    const uuid = "7d0c6a5e-1c3c-4b1a-9f3e-2d0f6b7c8a9b";
    const isArray = /ids$/i.test(field);
    expect(schema.safeParse(isArray ? [uuid] : uuid).success).toBe(true);
    expect(reject(schema, isArray ? ["not-a-uuid"] : "not-a-uuid")).toBe(true);
    expect(
      reject(schema, isArray ? [`${uuid}") OR 1==1`] : `${uuid}") OR 1==1`),
    ).toBe(true);
  });

  it.each(pageFields)(
    "$tool.page is a bounded positive integer",
    ({ schema }) => {
      expect(schema.safeParse(1).success).toBe(true);
      expect(schema.safeParse(1000).success).toBe(true);
      for (const bad of [0, -1, 1.5, 1001, 1e9, Number.NaN]) {
        expect(reject(schema, bad)).toBe(true);
      }
    },
  );

  it.each(dateFields)("$tool.$field is a YYYY-MM-DD date", ({ schema }) => {
    expect(schema.safeParse("2026-08-22").success).toBe(true);
    for (const bad of [
      "yesterday",
      "2026-8-2",
      "22/08/2026",
      "2026-08-22T00:00:00Z",
    ]) {
      expect(reject(schema, bad)).toBe(true);
    }
  });

  it.each(textFilterFields)(
    "$tool.$field cannot carry quotes or backslashes",
    ({ field, schema }) => {
      const isArray = /s$/.test(field) && field !== "searchTerm";
      const wrap = (value: string) => (isArray ? [value] : value);
      expect(schema.safeParse(wrap("INV-0042")).success).toBe(true);
      expect(reject(schema, wrap('x" OR 1==1'))).toBe(true);
      expect(reject(schema, wrap("x\\"))).toBe(true);
      expect(reject(schema, wrap("x".repeat(256)))).toBe(true);
    },
  );

  it.each(periodFields)(
    "$tool.periods is a small positive integer",
    ({ schema }) => {
      expect(schema.safeParse(3).success).toBe(true);
      for (const bad of [0, 13, 1.5, -1]) {
        expect(reject(schema, bad)).toBe(true);
      }
    },
  );
});
