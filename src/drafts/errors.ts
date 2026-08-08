export class DraftStateError extends Error {
  readonly code = "NOT_DRAFT";

  constructor(
    readonly resource: string,
    readonly targetId?: string,
    readonly status?: string,
  ) {
    super(
      status
        ? `${resource} ${targetId ?? "target"} is ${status}, not DRAFT`
        : `${resource} ${targetId ?? "target"} is not DRAFT`,
    );
    this.name = "DraftStateError";
  }
}

export class UnsupportedDraftResourceError extends Error {
  readonly code = "UNSUPPORTED_DRAFT_RESOURCE";

  constructor(readonly resource: string) {
    super(`Unsupported draft resource: ${resource}`);
    this.name = "UnsupportedDraftResourceError";
  }
}

export class XeroConflictError extends Error {
  readonly code = "XERO_CONFLICT";

  constructor(
    readonly resource: string,
    readonly targetId?: string,
  ) {
    super(
      targetId
        ? `${resource} ${targetId} changed in Xero`
        : `${resource} changed in Xero`,
    );
    this.name = "XeroConflictError";
  }
}
