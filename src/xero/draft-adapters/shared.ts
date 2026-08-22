import { z } from "zod";

import type { DraftOperation, Version } from "../../drafts/types.js";

export const MAX_TEXT_LENGTH = 500;
export const MAX_LONG_TEXT_LENGTH = 4000;
export const MAX_LINES = 500;

/** A bounded free-text field. Xero rejects most fields above a few hundred characters anyway. */
export function text(max = MAX_TEXT_LENGTH) {
  return z.string().max(max);
}

/** Descriptions and narrations, which Xero allows to run longer. */
export function longText() {
  return text(MAX_LONG_TEXT_LENGTH);
}

/** Monetary amounts and quantities: finite numbers only (zod 3 accepts Infinity by default). */
export function amount() {
  return z.number().finite();
}

/** A link rendered as a clickable "Go to" button inside the Xero UI: https only. */
export function httpsUrl() {
  return z
    .string()
    .max(2048)
    .url()
    .refine((value) => new URL(value).protocol === "https:", {
      message: "Only https:// links are allowed",
    });
}

export function lines<T extends z.ZodTypeAny>(schema: T) {
  return z.array(schema).max(MAX_LINES);
}

export function withoutUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, field]) => field !== undefined),
  );
}

export type ParseableOperation = Exclude<DraftOperation, "delete">;

/** Parse with the strict schema for creates and the partial schema for updates. */
export function parseFor<
  TPartial extends z.ZodTypeAny,
  TCreate extends z.ZodTypeAny,
>(
  schemas: { partial: TPartial; create: TCreate },
  input: unknown,
  operation: ParseableOperation,
): z.infer<TPartial> {
  const schema = operation === "create" ? schemas.create : schemas.partial;
  return withoutUndefined(schema.parse(input) as Record<string, unknown>);
}

/**
 * The only trustworthy version marker Xero returns is UpdatedDateUTC; a
 * record without one cannot be conflict-checked and must not be mutated.
 */
export function versionOf(
  updatedDateUTC: Date | string | undefined,
): Version | undefined {
  if (updatedDateUTC === undefined || updatedDateUTC === null) return undefined;
  const value =
    typeof updatedDateUTC === "string"
      ? updatedDateUTC
      : updatedDateUTC.toISOString();
  return value ? { value } : undefined;
}
