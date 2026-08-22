import { AxiosError } from "axios";

interface XeroSdkProblem {
  title?: string;
  detail?: string;
  status?: number;
}

interface XeroSdkError {
  response: {
    statusCode: number;
    body?: {
      httpStatusCode?: string;
      problem?: XeroSdkProblem;
      Detail?: string;
    };
  };
}

const SAFE_XERO_ERROR = "An error occurred while communicating with Xero.";

export function containsCredential(message: string): boolean {
  return (
    /(?:authorization\s*:\s*)?bearer\s+[^\s,;]+/i.test(message) ||
    /["']?(?:xero[_-])?client[_-]?secret["']?\s*(?:=|:)\s*/i.test(message)
  );
}

function safeMessage(message: unknown, fallback: string): string {
  if (typeof message !== "string" || containsCredential(message)) {
    return fallback;
  }
  return message;
}

function isXeroSdkError(error: unknown): error is XeroSdkError {
  if (typeof error !== "object" || error === null) return false;
  const response = (error as { response?: unknown }).response;
  if (typeof response !== "object" || response === null) return false;
  return typeof (response as { statusCode?: unknown }).statusCode === "number";
}

function formatHttpStatus(status: number): string {
  switch (status) {
    case 401:
      return "Authentication failed. Please check your Xero credentials.";
    case 403:
      return "You don't have permission to access this resource in Xero.";
    case 404:
      return "The requested resource was not found in Xero.";
    case 429:
      return "Too many requests to Xero. Please try again in a moment.";
    default:
      return "";
  }
}

/**
 * Format error messages for return to the LLM.
 *
 * Never stringify unknown error objects — the xero-node SDK rejects with a
 * plain object whose `request.headers.authorization` field contains the
 * caller's Bearer token. Whitelist the fields we extract so secrets never
 * reach the response.
 */
export function formatError(error: unknown): string {
  if (error instanceof AxiosError) {
    const status = error.response?.status;
    const detail = error.response?.data?.Detail;

    if (status !== undefined) {
      const mapped = formatHttpStatus(status);
      if (mapped) return mapped;
    }
    return safeMessage(detail, SAFE_XERO_ERROR);
  }

  if (isXeroSdkError(error)) {
    const status = error.response.statusCode;
    const mapped = formatHttpStatus(status);
    if (mapped) return mapped;

    const body = error.response.body;
    const problem = body?.problem;
    const title = problem?.title ?? body?.httpStatusCode ?? "HTTP error";
    const detail = problem?.detail ?? body?.Detail;
    const message = detail
      ? `${status} ${title}: ${detail}`
      : `${status} ${title}`;
    return safeMessage(message, SAFE_XERO_ERROR);
  }

  if (error instanceof Error) {
    return safeMessage(error.message, SAFE_XERO_ERROR);
  }

  return "An unexpected error occurred while communicating with Xero.";
}

/**
 * Render an arbitrary throwable for a log line without ever printing a stack
 * trace or the raw object graph (xero-node rejections carry Authorization
 * headers). Known secret literals are scrubbed; a message that looks like it
 * carries a credential is replaced wholesale.
 */
export function redactErrorMessage(
  error: unknown,
  secrets: readonly string[] = [],
): string {
  const name = error instanceof Error ? error.name : "Error";
  let message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown error";

  for (const secret of secrets) {
    if (secret) message = message.split(secret).join("[redacted]");
  }
  if (containsCredential(message)) {
    message = "[redacted: message contained a credential]";
  }

  return `${name}: ${message}`;
}
