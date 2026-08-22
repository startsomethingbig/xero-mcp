import { createHash } from "node:crypto";

import { z } from "zod";

import {
  DraftStateError,
  UnsupportedDraftResourceError,
  VersionUnavailableError,
  XeroConflictError,
} from "./errors.js";
import {
  ConfirmationError,
  type Clock,
  type ConfirmationInput,
  type ConfirmationStore,
} from "./confirmation-store.js";
import type { DraftOperation, DraftResourceAdapter, Version } from "./types.js";

type AnyDraftResourceAdapter = DraftResourceAdapter<unknown, unknown>;

const operationSchema = z.enum(["create", "update", "delete"]);
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

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

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashCanonicalPayload(payload: unknown): string {
  return sha256(canonicalJson(payload));
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

function requireOperation(operation: unknown): DraftOperation {
  const parsed = operationSchema.safeParse(operation);
  if (!parsed.success) {
    throw new TypeError(
      `Unsupported draft operation: ${JSON.stringify(operation)}`,
    );
  }
  return parsed.data;
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

  /** Previews awaiting apply (expired ones are swept on each preview). */
  get pendingCount(): number {
    return this.pending.size;
  }

  async preview(command: DraftCommand): Promise<DraftPreview> {
    const operation = requireOperation(command.operation);
    const adapter = this.getAdapter(command.resource);
    if (!adapter) throw new UnsupportedDraftResourceError(command.resource);

    let payload: unknown;
    let targetVersion: Version | undefined;
    if (operation === "create" || operation === "update") {
      payload = {
        ...requireObjectPayload(
          adapter.parsePayload(command.payload, operation),
        ),
        status: "DRAFT",
      };
    }

    if (operation === "update" || operation === "delete") {
      const targetId = requireTargetId(command);
      const target = await adapter.get(targetId);
      this.requireDraft(adapter, target, command.resource, targetId);
      targetVersion = this.requireVersion(
        adapter,
        target,
        command.resource,
        targetId,
      );
    }

    this.sweepPending();

    const expiresAt = new Date(
      this.clock().getTime() + this.confirmationTtlSeconds * 1_000,
    ).toISOString();
    const input: ConfirmationInput = {
      operation,
      resource: command.resource,
      canonicalPayloadHash: hashCanonicalPayload(payload),
      tenantId: this.tenantId,
      targetId: command.targetId,
      targetVersion,
      expiresAt,
    };
    const confirmationToken = await this.confirmations.mint(input);
    this.pending.set(this.confirmations.hashToken(confirmationToken), {
      ...structuredClone(input),
      adapter,
      payload: structuredClone(payload),
    });

    return {
      operation,
      resource: command.resource,
      ...(command.targetId ? { targetId: command.targetId } : {}),
      ...(payload === undefined ? {} : { payload: structuredClone(payload) }),
      expiresAt,
      confirmationToken,
    };
  }

  async apply(token: string): Promise<DraftApplyResult> {
    if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) {
      throw new ConfirmationError("CONFIRMATION_INVALID");
    }

    const tokenHash = this.confirmations.hashToken(token);
    const pending = this.pending.get(tokenHash);
    if (!pending) {
      // Never consume a token we did not mint; just report its state.
      const state = this.confirmations.inspect(token);
      throw new ConfirmationError(
        state === "consumed"
          ? "CONFIRMATION_USED"
          : state === "expired"
            ? "CONFIRMATION_EXPIRED"
            : "CONFIRMATION_INVALID",
      );
    }

    try {
      const record = await this.confirmations.consume(token, {
        operation: pending.operation,
        resource: pending.resource,
        canonicalPayloadHash: hashCanonicalPayload(pending.payload),
        tenantId: this.tenantId,
        targetId: pending.targetId,
        targetVersion: pending.targetVersion,
        expiresAt: pending.expiresAt,
      });

      const applied = await this.execute(pending, record.operation);
      return {
        operation: record.operation,
        resource: record.resource,
        targetId: pending.adapter.getId(applied),
        record: applied,
      };
    } finally {
      // Whatever happened, the preview is spent: success, rejection, or a
      // failed Xero call all require a fresh preview.
      this.pending.delete(tokenHash);
    }
  }

  private async execute(
    pending: PendingCommand,
    operation: DraftOperation,
  ): Promise<unknown> {
    switch (operation) {
      case "create":
        return pending.adapter.create(
          requireDraftPayload(pending.payload),
          this.idempotencyKey(pending),
        );
      case "update":
      case "delete": {
        const targetId = pending.targetId;
        if (!targetId) throw new ConfirmationError("CONFIRMATION_MISMATCH");
        const target = await pending.adapter.get(targetId);
        this.requireDraft(pending.adapter, target, pending.resource, targetId);
        const version = this.requireVersion(
          pending.adapter,
          target,
          pending.resource,
          targetId,
        );
        if (version.value !== pending.targetVersion?.value) {
          throw new XeroConflictError(pending.resource, targetId);
        }
        return operation === "update"
          ? pending.adapter.update(
              targetId,
              requireDraftPayload(pending.payload),
            )
          : pending.adapter.delete(targetId);
      }
      default: {
        const unreachable: never = operation;
        void unreachable;
        throw new ConfirmationError("CONFIRMATION_MISMATCH");
      }
    }
  }

  /**
   * Stable per-operation key so that a create retried after a timeout (which
   * necessarily goes through a fresh preview) is deduplicated by Xero instead
   * of producing a second draft.
   */
  private idempotencyKey(pending: PendingCommand): string {
    return sha256(
      [this.tenantId, pending.resource, pending.canonicalPayloadHash].join(
        "\n",
      ),
    );
  }

  private sweepPending(): void {
    const now = this.clock().getTime();
    for (const [tokenHash, command] of this.pending) {
      const expiresAt = new Date(command.expiresAt).getTime();
      if (!Number.isFinite(expiresAt) || now >= expiresAt) {
        this.pending.delete(tokenHash);
      }
    }
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

  private requireVersion(
    adapter: AnyDraftResourceAdapter,
    record: unknown,
    resource: string,
    targetId: string,
  ): Version {
    const version = adapter.getVersion(record);
    if (!version?.value) {
      throw new VersionUnavailableError(resource, targetId);
    }
    return version;
  }
}
