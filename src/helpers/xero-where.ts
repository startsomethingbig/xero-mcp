/**
 * Safe construction of Xero `where` filter expressions.
 *
 * Xero's filter language is a string the API parses, so any caller-supplied
 * value interpolated into it is an injection point: a quote in a reference
 * can append `OR` clauses and widen a scoped query to the whole tenant.
 * Values are validated, never escaped, because Xero does not document an
 * escaping grammar we could rely on.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FILTER_LENGTH = 255;
/** No quotes, no backslashes, no control characters. */
const SAFE_FILTER_PATTERN = /^[^"\\\p{Cc}]*$/u;

export function guidFilter(field: string, value: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new Error(`${field} must be a valid Xero ID (UUID)`);
  }
  return `${field}==guid("${value.toLowerCase()}")`;
}

export function stringFilter(field: string, value: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_FILTER_LENGTH ||
    !SAFE_FILTER_PATTERN.test(value)
  ) {
    throw new Error(
      `${field} filter value must be 1-${MAX_FILTER_LENGTH} characters without quotes, backslashes or control characters`,
    );
  }
  return `${field}=="${value}"`;
}

export function whereAll(
  conditions: ReadonlyArray<string | undefined>,
): string | undefined {
  const present = conditions.filter((c): c is string => Boolean(c));
  return present.length > 0 ? present.join(" AND ") : undefined;
}
