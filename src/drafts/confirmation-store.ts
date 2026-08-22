import { createHmac, randomBytes as secureRandomBytes } from "node:crypto";

import type { DraftOperation, Version } from "./types.js";

export type Clock = () => Date;
export type RandomBytes = (size: number) => Uint8Array;

export interface ConfirmationInput {
  operation: DraftOperation;
  resource: string;
  canonicalPayloadHash: string;
  tenantId: string;
  targetId?: string;
  targetVersion?: Version;
  expiresAt: string;
}

export type ConfirmationExpected = Partial<ConfirmationInput>;

export interface ConfirmationRecord extends ConfirmationInput {
  tokenHash: string;
  consumedAt?: string;
}

type ConfirmationErrorCode =
  | "CONFIRMATION_INVALID"
  | "CONFIRMATION_EXPIRED"
  | "CONFIRMATION_USED"
  | "CONFIRMATION_MISMATCH";

export class ConfirmationError extends Error {
  constructor(readonly code: ConfirmationErrorCode) {
    super(code);
    this.name = "ConfirmationError";
  }
}

function sameVersion(left: Version | undefined, right: Version | undefined) {
  return left?.value === right?.value;
}

function bindingsMatch(
  record: ConfirmationRecord,
  expected: ConfirmationExpected,
): boolean {
  return (
    (!Object.hasOwn(expected, "operation") ||
      record.operation === expected.operation) &&
    (!Object.hasOwn(expected, "resource") ||
      record.resource === expected.resource) &&
    (!Object.hasOwn(expected, "canonicalPayloadHash") ||
      record.canonicalPayloadHash === expected.canonicalPayloadHash) &&
    (!Object.hasOwn(expected, "tenantId") ||
      record.tenantId === expected.tenantId) &&
    (!Object.hasOwn(expected, "targetId") ||
      record.targetId === expected.targetId) &&
    (!Object.hasOwn(expected, "targetVersion") ||
      sameVersion(record.targetVersion, expected.targetVersion)) &&
    (!Object.hasOwn(expected, "expiresAt") ||
      record.expiresAt === expected.expiresAt)
  );
}

export interface ConfirmationStoreOptions {
  /**
   * Keys the token hash (HMAC-SHA256). Tokens minted under one secret are
   * unknown to a store using another, and a leaked record table cannot be
   * matched against tokens without it.
   */
  secret: string;
  /** Upper bound on live (unexpired) records; protects memory under preview spam. */
  maxRecords?: number;
  clock?: Clock;
  randomBytes?: RandomBytes;
}

const DEFAULT_MAX_RECORDS = 1000;

export class ConfirmationStore {
  private readonly records = new Map<string, ConfirmationRecord>();
  private readonly secret: string;
  private readonly maxRecords: number;
  private readonly clock: Clock;
  private readonly randomBytes: RandomBytes;

  constructor({
    secret,
    maxRecords = DEFAULT_MAX_RECORDS,
    clock = () => new Date(),
    randomBytes = secureRandomBytes,
  }: ConfirmationStoreOptions) {
    if (typeof secret !== "string" || secret.length === 0) {
      throw new Error("ConfirmationStore requires a non-empty secret");
    }
    this.secret = secret;
    this.maxRecords = maxRecords;
    this.clock = clock;
    this.randomBytes = randomBytes;
  }

  /** Number of records currently held (consumed records stay until they expire). */
  get size(): number {
    return this.records.size;
  }

  private isExpired(record: ConfirmationRecord, now: number): boolean {
    const expiresAt = new Date(record.expiresAt).getTime();
    return !Number.isFinite(expiresAt) || now >= expiresAt;
  }

  /** Forget every record past its expiry. Called on each write and read. */
  private sweep(): void {
    const now = this.clock().getTime();
    for (const [tokenHash, record] of this.records) {
      if (this.isExpired(record, now)) this.records.delete(tokenHash);
    }
  }

  /** Non-consuming look at a token's state, for accurate error reporting. */
  inspect(token: string): "unknown" | "live" | "consumed" | "expired" {
    const record = this.records.get(this.hashToken(token));
    if (!record) return "unknown";
    if (this.isExpired(record, this.clock().getTime())) return "expired";
    return record.consumedAt ? "consumed" : "live";
  }

  /** Keyed digest of a token; the only form in which a token is ever stored. */
  hashToken(token: string): string {
    return createHmac("sha256", this.secret).update(token).digest("hex");
  }

  async mint(input: ConfirmationInput): Promise<string> {
    this.sweep();
    if (this.records.size >= this.maxRecords) {
      throw new Error(
        "Too many pending confirmations; wait for existing previews to expire",
      );
    }

    const bytes = this.randomBytes(32);
    if (bytes.byteLength !== 32) {
      throw new TypeError("RandomBytes must return exactly 32 bytes");
    }

    const token = Buffer.from(bytes).toString("base64url");
    const tokenHash = this.hashToken(token);
    if (this.records.has(tokenHash)) {
      throw new Error("Confirmation token collision");
    }

    this.records.set(tokenHash, {
      tokenHash,
      ...structuredClone(input),
    });
    return token;
  }

  async consume(
    token: string,
    expected: ConfirmationExpected,
  ): Promise<ConfirmationRecord> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new ConfirmationError("CONFIRMATION_INVALID");
    }

    const tokenHash = this.hashToken(token);
    const record = this.records.get(tokenHash);
    if (!record) throw new ConfirmationError("CONFIRMATION_INVALID");
    if (this.isExpired(record, this.clock().getTime())) {
      this.sweep();
      throw new ConfirmationError(
        record.consumedAt ? "CONFIRMATION_INVALID" : "CONFIRMATION_EXPIRED",
      );
    }
    if (record.consumedAt) throw new ConfirmationError("CONFIRMATION_USED");
    if (!bindingsMatch(record, expected)) {
      throw new ConfirmationError("CONFIRMATION_MISMATCH");
    }

    record.consumedAt = this.clock().toISOString();
    return structuredClone(record);
  }
}
