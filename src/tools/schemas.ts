import { z } from "zod";

/**
 * Shared input schemas for read tools. Every value here ends up in a Xero
 * query (IDs and filter strings inside `where`, pages and dates as query
 * parameters), so each is constrained to exactly what Xero can accept.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FILTER_LENGTH = 255;
const SAFE_FILTER_PATTERN = /^[^"\\\p{Cc}]*$/u;

/** A Xero record identifier. */
export function xeroId() {
  return z.string().regex(UUID_PATTERN, "must be a Xero ID (UUID)");
}

/** A page number for Xero's paginated endpoints. */
export function page() {
  return z.number().int().min(1).max(1000);
}

/** A calendar date in the YYYY-MM-DD form Xero's report endpoints expect. */
export function isoDate() {
  return z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");
}

/** Free text that is interpolated into a Xero `where` filter. */
export function filterText() {
  return z
    .string()
    .min(1)
    .max(MAX_FILTER_LENGTH)
    .regex(
      SAFE_FILTER_PATTERN,
      "must not contain quotes, backslashes or control characters",
    );
}

/** Number of report periods Xero will return. */
export function periods() {
  return z.number().int().min(1).max(12);
}
