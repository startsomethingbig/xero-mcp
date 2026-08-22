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
  clock?: Clock;
  randomBytes?: RandomBytes;
}

export class ConfirmationStore {
  private readonly records = new Map<string, ConfirmationRecord>();
  private readonly secret: string;
  private readonly clock: Clock;
  private readonly randomBytes: RandomBytes;

  constructor({
    secret,
    clock = () => new Date(),
    randomBytes = secureRandomBytes,
  }: ConfirmationStoreOptions) {
    if (typeof secret !== "string" || secret.length === 0) {
      throw new Error("ConfirmationStore requires a non-empty secret");
    }
    this.secret = secret;
    this.clock = clock;
    this.randomBytes = randomBytes;
  }

  /** Keyed digest of a token; the only form in which a token is ever stored. */
  hashToken(token: string): string {
    return createHmac("sha256", this.secret).update(token).digest("hex");
  }

  async mint(input: ConfirmationInput): Promise<string> {
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
    if (record.consumedAt) throw new ConfirmationError("CONFIRMATION_USED");
    if (this.clock().getTime() >= new Date(record.expiresAt).getTime()) {
      throw new ConfirmationError("CONFIRMATION_EXPIRED");
    }
    if (!bindingsMatch(record, expected)) {
      throw new ConfirmationError("CONFIRMATION_MISMATCH");
    }

    record.consumedAt = this.clock().toISOString();
    return structuredClone(record);
  }
}
