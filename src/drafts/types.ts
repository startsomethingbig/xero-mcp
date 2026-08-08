export type DraftOperation = "create" | "update" | "delete";

export type Version = { value: string };

export interface DraftResourceAdapter<P, R> {
  readonly kind: string;
  parsePayload(input: unknown): P;
  get(id: string): Promise<R | undefined>;
  create(payload: P & { status: "DRAFT" }, idempotencyKey: string): Promise<R>;
  update(id: string, payload: P & { status: "DRAFT" }): Promise<R>;
  delete(id: string): Promise<R>;
  getId(record: R): string;
  getStatus(record: R): string | undefined;
  getVersion(record: R): Version;
}
