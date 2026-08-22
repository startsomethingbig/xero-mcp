export type DraftOperation = "create" | "update" | "delete";

export type Version = { value: string };

export interface DraftResourceAdapter<P, R> {
  readonly kind: string;
  /** Validate caller input; creates use the strict schema, updates the partial one. */
  parsePayload(input: unknown, operation: Exclude<DraftOperation, "delete">): P;
  get(id: string): Promise<R | undefined>;
  create(payload: P & { status: "DRAFT" }, idempotencyKey: string): Promise<R>;
  update(id: string, payload: P & { status: "DRAFT" }): Promise<R>;
  delete(id: string): Promise<R>;
  getId(record: R): string;
  getStatus(record: R): string | undefined;
  /** Undefined when Xero gave no version marker; such records are never mutated. */
  getVersion(record: R): Version | undefined;
}
