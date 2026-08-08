import { createHash } from "node:crypto";

import {
  DraftStateError,
  UnsupportedDraftResourceError,
  XeroConflictError,
} from "./errors.js";
import {
  ConfirmationError,
  type Clock,
  type ConfirmationInput,
  type ConfirmationStore,
  hashConfirmationToken,
} from "./confirmation-store.js";
import type { DraftOperation, DraftResourceAdapter, Version } from "./types.js";

type AnyDraftResourceAdapter = DraftResourceAdapter<unknown, unknown>;

export interface DraftCommand {
  operation: DraftOperation;
  resource: string;
  targetId?: string;
  payload?: unknown;
}

export interface DraftPreview {
  operation: DraftOperation;
  resource: string;
  targetId?: string;
  payload?: unknown;
  expiresAt: string;
  confirmationToken: string;
}

export interface DraftApplyResult {
  operation: DraftOperation;
  resource: string;
  targetId?: string;
  record: unknown;
}

interface PendingCommand extends ConfirmationInput {
  adapter: AnyDraftResourceAdapter;
  payload?: unknown;
}

export interface DraftCommandServiceOptions {
  tenantId: string;
  confirmationTtlSeconds?: number;
  clock?: Clock;
  confirmations: ConfirmationStore;
  getAdapter(resource: string): AnyDraftResourceAdapter | undefined;
}

function hashCanonicalPayload(payload: unknown): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "undefined";
  }
  if (Array.isArray(value)) {
    return `[${value
      .map((item) => (item === undefined ? "null" : canonicalJson(item)))
      .join(",")}]`;
  }

  const object = value as Record<string, unknown>;
  const entries = Object.keys(object)
    .filter((key) => object[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`);
  return `{${entries.join(",")}}`;
}

function requireObjectPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("Draft payload must be an object");
  }
  return payload as Record<string, unknown>;
}

function requireDraftPayload(payload: unknown): { status: "DRAFT" } {
  if (
    !payload ||
    typeof payload !== "object" ||
    (payload as { status?: unknown }).status !== "DRAFT"
  ) {
    throw new ConfirmationError("CONFIRMATION_MISMATCH");
  }
  return payload as { status: "DRAFT" };
}

function requireTargetId(command: DraftCommand): string {
  if (!command.targetId) {
    throw new TypeError(`${command.operation} requires a targetId`);
  }
  return command.targetId;
}

export class DraftCommandService {
  private readonly tenantId: string;
  private readonly confirmationTtlSeconds: number;
  private readonly clock: Clock;
  private readonly confirmations: ConfirmationStore;
  private readonly getAdapter: DraftCommandServiceOptions["getAdapter"];
  private readonly pending = new Map<string, PendingCommand>();

  constructor({
    tenantId,
    confirmationTtlSeconds = 600,
    clock = () => new Date(),
    confirmations,
    getAdapter,
  }: DraftCommandServiceOptions) {
    this.tenantId = tenantId;
    this.confirmationTtlSeconds = confirmationTtlSeconds;
    this.clock = clock;
    this.confirmations = confirmations;
    this.getAdapter = getAdapter;
  }

  async preview(command: DraftCommand): Promise<DraftPreview> {
    const adapter = this.getAdapter(command.resource);
    if (!adapter) throw new UnsupportedDraftResourceError(command.resource);

    let payload: unknown;
    let targetVersion: Version | undefined;
    if (command.operation === "create" || command.operation === "update") {
      payload = {
        ...requireObjectPayload(adapter.parsePayload(command.payload)),
        status: "DRAFT",
      };
    }

    if (command.operation === "update" || command.operation === "delete") {
      const targetId = requireTargetId(command);
      const target = await adapter.get(targetId);
      this.requireDraft(adapter, target, command.resource, targetId);
      targetVersion = adapter.getVersion(target);
    }

    const expiresAt = new Date(
      this.clock().getTime() + this.confirmationTtlSeconds * 1_000,
    ).toISOString();
    const input: ConfirmationInput = {
      operation: command.operation,
      resource: command.resource,
      canonicalPayloadHash: hashCanonicalPayload(payload),
      tenantId: this.tenantId,
      targetId: command.targetId,
      targetVersion,
      expiresAt,
    };
    const confirmationToken = await this.confirmations.mint(input);
    const tokenHash = hashConfirmationToken(confirmationToken);
    this.pending.set(tokenHash, {
      ...structuredClone(input),
      adapter,
      payload: structuredClone(payload),
    });

    return {
      operation: command.operation,
      resource: command.resource,
      ...(command.targetId ? { targetId: command.targetId } : {}),
      ...(payload === undefined ? {} : { payload: structuredClone(payload) }),
      expiresAt,
      confirmationToken,
    };
  }

  async apply(token: string): Promise<DraftApplyResult> {
    const tokenHash = hashConfirmationToken(token);
    const pending = this.pending.get(tokenHash);
    if (!pending) {
      await this.confirmations.consume(token, { tenantId: this.tenantId });
      throw new ConfirmationError("CONFIRMATION_INVALID");
    }

    const record = await this.confirmations.consume(token, {
      operation: pending.operation,
      resource: pending.resource,
      canonicalPayloadHash: hashCanonicalPayload(pending.payload),
      tenantId: this.tenantId,
      targetId: pending.targetId,
      targetVersion: pending.targetVersion,
      expiresAt: pending.expiresAt,
    });
    this.pending.delete(tokenHash);

    let applied: unknown;
    if (record.operation === "create") {
      applied = await pending.adapter.create(
        requireDraftPayload(pending.payload),
        record.tokenHash,
      );
    } else {
      const targetId = record.targetId;
      if (!targetId) throw new ConfirmationError("CONFIRMATION_MISMATCH");
      const target = await pending.adapter.get(targetId);
      this.requireDraft(pending.adapter, target, record.resource, targetId);
      if (
        pending.adapter.getVersion(target).value !== record.targetVersion?.value
      ) {
        throw new XeroConflictError(record.resource, targetId);
      }
      applied =
        record.operation === "update"
          ? await pending.adapter.update(
              targetId,
              requireDraftPayload(pending.payload),
            )
          : await pending.adapter.delete(targetId);
    }

    return {
      operation: record.operation,
      resource: record.resource,
      targetId: pending.adapter.getId(applied),
      record: applied,
    };
  }

  private requireDraft(
    adapter: AnyDraftResourceAdapter,
    record: unknown | undefined,
    resource: string,
    targetId: string,
  ): asserts record {
    const status = record === undefined ? undefined : adapter.getStatus(record);
    if (status !== "DRAFT") {
      throw new DraftStateError(resource, targetId, status);
    }
  }
}
