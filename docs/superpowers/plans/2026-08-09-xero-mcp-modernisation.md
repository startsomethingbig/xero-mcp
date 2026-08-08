# Xero MCP 2026-07-28 Modernisation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy MCP server with a 2026-07-28-compliant TypeScript implementation and safely support confirmed draft-only Xero mutations.

**Architecture:** A fresh MCP v2 server is created per HTTP request or stdio connection and delegates to a transport-independent tool catalogue. A draft-command service is the only mutating boundary; it validates a registered draft-capable resource, issues an opaque single-use preview token, then revalidates the Xero record before applying a create, update, or delete.

**Tech Stack:** Node.js 22+, TypeScript 5.9, `@modelcontextprotocol/server` v2, `@modelcontextprotocol/node`, `@modelcontextprotocol/client`, `xero-node`, Zod 3, Vitest 4, ESLint 9.

## Global Constraints

- Implement MCP `2026-07-28` only: HTTP rejects legacy 2025-era traffic (`legacy: 'reject'`); never implement initialize/session state.
- Serve both stateless HTTP `POST /mcp` and stdio from one `createXeroMcpServer` factory.
- The deployment has exactly one Xero tenant, supplied as `XERO_TENANT_ID`; no tenant is inferred from the first connection.
- Any Xero mutation must flow through `DraftCommandService`; tools never import a Xero API client directly.
- A create operation always sends `status: DRAFT`; update/delete re-fetch the resource and reject a status other than `DRAFT` before a mutation API call.
- Every mutation is previewed first and requires a 10-minute, opaque, single-use confirmation token bound to operation, canonical payload, resource, tenant, and record version.
- Do not expose mutations for non-draft resources (contacts, payments, payroll, items, accounts, tracking configuration) or any status transition.
- Tests run without Xero credentials; optional live-sandbox tests are separate and never run in pull-request CI.
- Use TDD for every production behavior: write a focused failing test, run it to observe its expected failure, implement the minimum code, then run the focused and full suites.

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `src/config/environment.ts` | Parse and validate redacted single-tenant configuration. |
| `src/xero/client.ts` | Wrap `xero-node` behind `XeroApi` and attach auth, tenant, idempotency key. |
| `src/drafts/types.ts` | Resource, operation, record-version, preview, and adapter contracts. |
| `src/drafts/confirmation-store.ts` | In-memory opaque-token lifecycle with injected clock/randomness. |
| `src/drafts/draft-command-service.ts` | Preview/apply safety invariants; sole mutation gateway. |
| `src/drafts/resource-registry.ts` | Explicit allow-list of draft-capable resource adapters. |
| `src/xero/draft-adapters/*.ts` | One Xero API adapter per approved draft resource. |
| `src/mcp/server.ts` | MCP v2 server factory and deterministic tool registration. |
| `src/mcp/draft-tools.ts` | Preview/apply tool definitions that call the draft-command service. |
| `src/mcp/read-tools.ts` | Ported read-only tool registration and common result mapping. |
| `src/transports/http.ts` | Node HTTP server mounting strict modern MCP at `/mcp`. |
| `src/transports/stdio.ts` | Stdio bootstrap using the same MCP server factory. |
| `src/index.ts` | CLI dispatch: `stdio` (default) or `http`. |
| `evals/draft-scenarios.jsonl` | Version-controlled scenario evaluation inputs and expected outcomes. |
| `.github/workflows/ci.yml` | Typecheck, lint, build, unit/contract/eval tests on PRs. |

### Task 1: Establish the modern dependency, configuration, and test baseline

**Files:**
- Modify: `package.json`, `package-lock.json`, `tsconfig.json`, `.env.example`, `README.md`
- Create: `src/config/environment.ts`, `src/config/environment.test.ts`, `src/test/fakes.ts`

**Interfaces:**
- Produces `loadEnvironment(env: NodeJS.ProcessEnv): XeroEnvironment`.
- Produces `XeroEnvironment = { clientId: string; clientSecret: string; tenantId: string; port: number; confirmationTtlSeconds: number; confirmationSecret: string }`.
- Test helpers expose `fixedClock(iso: string): () => Date` and `fakeXeroApi(): FakeXeroApi`.

- [ ] **Step 1: Write the failing environment tests**

```ts
import { describe, expect, it } from "vitest";
import { loadEnvironment } from "./environment.js";

describe("loadEnvironment", () => {
  it("requires an explicit tenant and redacts secret values", () => {
    expect(() => loadEnvironment({ XERO_CLIENT_ID: "client", XERO_CLIENT_SECRET: "top-secret" }))
      .toThrow("XERO_TENANT_ID is required");
    expect(() => loadEnvironment({ XERO_CLIENT_ID: "client", XERO_CLIENT_SECRET: "top-secret", XERO_TENANT_ID: "tenant" }))
      .not.toThrow();
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails because the module is missing**

Run: `npm test -- src/config/environment.test.ts`

Expected: FAIL with a module-not-found error for `environment.js`.

- [ ] **Step 3: Replace the v1 MCP package and add the configuration module**

In `package.json`, remove `@modelcontextprotocol/sdk`; add `@modelcontextprotocol/server`, `@modelcontextprotocol/node`, and `@modelcontextprotocol/client` at the current v2 release line. Add scripts: `typecheck: tsc --noEmit`, `test:unit: vitest run`, and `test:eval: vitest run src/evals`. Add `"types": ["node"]` in `tsconfig.json`.

Implement:

```ts
export function loadEnvironment(env: NodeJS.ProcessEnv): XeroEnvironment {
  const required = ["XERO_CLIENT_ID", "XERO_CLIENT_SECRET", "XERO_TENANT_ID", "XERO_CONFIRMATION_SECRET"] as const;
  for (const key of required) if (!env[key]?.trim()) throw new Error(`${key} is required`);
  return {
    clientId: env.XERO_CLIENT_ID!, clientSecret: env.XERO_CLIENT_SECRET!, tenantId: env.XERO_TENANT_ID!,
    confirmationSecret: env.XERO_CONFIRMATION_SECRET!, port: Number(env.PORT ?? 3000),
    confirmationTtlSeconds: Number(env.XERO_CONFIRMATION_TTL_SECONDS ?? 600),
  };
}
```

Update `.env.example` with names only, no real values; document `npm run dev -- stdio` and `npm run dev -- http` as future commands in README without claiming they work before Task 3.

- [ ] **Step 4: Run configuration, typecheck, lint, and build checks**

Run: `npm install && npm test -- src/config/environment.test.ts && npm run typecheck && npm run lint && npm run build`

Expected: PASS, with no secret string printed by the test output.

- [ ] **Step 5: Commit the baseline**

```bash
git add package.json package-lock.json tsconfig.json .env.example README.md src/config src/test
git commit -m "chore: establish MCP v2 configuration baseline"
```

### Task 2: Create strict MCP 2026-07-28 HTTP and stdio transports

**Files:**
- Create: `src/mcp/server.ts`, `src/transports/http.ts`, `src/transports/stdio.ts`, `src/transports/http.test.ts`, `src/transports/stdio.test.ts`
- Modify: `src/index.ts`
- Delete: `src/server/xero-mcp-server.ts`

**Interfaces:**
- Produces `createXeroMcpServer(dependencies: ServerDependencies): McpServer`.
- Produces `createHttpServer(dependencies: ServerDependencies): Server` listening only on `POST /mcp`.
- Produces `serveStdio(createServer: McpServerFactory): Promise<void>`.

- [ ] **Step 1: Write failing modern-protocol transport tests**

```ts
it("serves server/discover without a session", async () => {
  const response = await fetchMcp(app, {
    method: "server/discover", params: { _meta: { "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" } } },
  });
  expect(response.status).toBe(200);
  expect(response.body.result._meta["io.modelcontextprotocol/serverInfo"].name).toBe("xero-mcp");
});

it("rejects a legacy initialize request", async () => {
  const response = await fetchMcp(app, { method: "initialize", params: {} });
  expect(response.body.error.code).toBe(-32022);
});
```

- [ ] **Step 2: Run the focused transport test and verify it fails because the transport does not exist**

Run: `npm test -- src/transports/http.test.ts`

Expected: FAIL with a module-not-found error for `http.js`.

- [ ] **Step 3: Implement the server factory and transports using the v2 entry points**

Use `createMcpHandler(createXeroMcpServer, { legacy: "reject", responseMode: "json" })` and `toNodeHandler` to mount one handler at `/mcp`. Reject every other method/path with 404 or 405. Place host and origin validation middleware before the handler; allow configured `MCP_ALLOWED_ORIGINS` and localhost for local development. Use `serveStdio(createXeroMcpServer)` for stdio.

`src/index.ts` must parse exactly one optional mode argument: no argument or `stdio` starts stdio; `http` starts the HTTP listener on `environment.port`; any other mode writes a usage error to stderr and exits 2.

- [ ] **Step 4: Run protocol checks and both focused test files**

Run: `npm test -- src/transports/http.test.ts src/transports/stdio.test.ts && npm run typecheck`

Expected: PASS. The HTTP test shows no `Mcp-Session-Id` requirement and the `initialize` request receives the protocol-version error.

- [ ] **Step 5: Commit the transport migration**

```bash
git add src/index.ts src/mcp/server.ts src/transports src/server/xero-mcp-server.ts
git commit -m "feat: serve MCP 2026 over HTTP and stdio"
```

### Task 3: Isolate Xero authentication and define the draft resource contract

**Files:**
- Create: `src/xero/client.ts`, `src/xero/client.test.ts`, `src/drafts/types.ts`, `src/drafts/errors.ts`
- Modify: `src/clients/xero-client.ts`
- Delete: `src/helpers/get-client-headers.ts`

**Interfaces:**
- Produces `XeroApi` with `get(resource, id)`, `create(resource, payload, idempotencyKey)`, `update(resource, id, payload)`, and `delete(resource, id)` methods.
- Produces `DraftResourceAdapter<TPayload, TRecord>` with `kind`, `parsePayload`, `get`, `create`, `update`, `delete`, `getId`, `getStatus`, and `getVersion`.
- Produces `DraftStateError`, `UnsupportedDraftResourceError`, and `XeroConflictError`.

- [ ] **Step 1: Write failing Xero client boundary tests**

```ts
it("uses the configured tenant instead of the first connected tenant", async () => {
  const sdk = fakeSdkWithConnections(["wrong-tenant", "configured-tenant"]);
  const api = createXeroApi(environment, sdk);
  await api.create("invoice", { status: "DRAFT" }, "idem-1");
  expect(sdk.lastTenantId).toBe("configured-tenant");
});

it("redacts a bearer token in an upstream error", () => {
  expect(formatXeroError(new Error("Authorization: Bearer secret-token"))).toBe("Xero request failed");
});
```

- [ ] **Step 2: Run the focused test and verify it fails because `createXeroApi` is missing**

Run: `npm test -- src/xero/client.test.ts`

Expected: FAIL with `createXeroApi is not a function` or module-not-found.

- [ ] **Step 3: Implement the wrapper and replace global authentication**

Move SDK construction behind `createXeroApi(environment, sdk = new XeroClient(...))`. Authenticate with configured client credentials, always select `environment.tenantId`, and map errors through `formatXeroError`. Remove module-load environment validation and the exported global `xeroClient`; dependency-inject `XeroApi` into adapters instead.

Define the domain contracts:

```ts
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
```

- [ ] **Step 4: Run focused and repository tests**

Run: `npm test -- src/xero/client.test.ts && npm test && npm run lint && npm run typecheck`

Expected: PASS. No existing handler imports `xeroClient` after this task.

- [ ] **Step 5: Commit the domain boundary**

```bash
git add src/xero src/drafts/types.ts src/drafts/errors.ts src/clients/xero-client.ts src/helpers/get-client-headers.ts
git commit -m "refactor: isolate configured Xero API client"
```

### Task 4: Implement confirmation tokens and the draft-command safety service

**Files:**
- Create: `src/drafts/confirmation-store.ts`, `src/drafts/confirmation-store.test.ts`, `src/drafts/draft-command-service.ts`, `src/drafts/draft-command-service.test.ts`

**Interfaces:**
- Produces `ConfirmationStore.mint(input): Promise<string>` and `consume(token, expected): Promise<ConfirmationRecord>`.
- Produces `DraftCommandService.preview(command): Promise<DraftPreview>` and `apply(token): Promise<DraftApplyResult>`.
- `DraftPreview = { operation: DraftOperation; resource: string; targetId?: string; payload?: unknown; expiresAt: string; confirmationToken: string }`.

- [ ] **Step 1: Write failing token and safety invariant tests**

```ts
it("does not mutate during preview and accepts a token once", async () => {
  const { service, api } = buildDraftService();
  const preview = await service.preview({ operation: "create", resource: "invoice", payload: invoicePayload });
  expect(api.createCalls).toHaveLength(0);
  await service.apply(preview.confirmationToken);
  await expect(service.apply(preview.confirmationToken)).rejects.toMatchObject({ code: "CONFIRMATION_USED" });
});

it("rejects an authorised target before update reaches Xero", async () => {
  const { service, api } = buildDraftService({ status: "AUTHORISED" });
  await expect(service.preview({ operation: "update", resource: "invoice", targetId: "inv-1", payload: invoicePayload }))
    .rejects.toMatchObject({ code: "NOT_DRAFT" });
  expect(api.updateCalls).toHaveLength(0);
});
```

- [ ] **Step 2: Run the focused tests and verify expected failures**

Run: `npm test -- src/drafts/confirmation-store.test.ts src/drafts/draft-command-service.test.ts`

Expected: FAIL because the store and service modules do not exist.

- [ ] **Step 3: Implement opaque single-use confirmation state**

Generate 32 random bytes as a base64url token; persist only a SHA-256 hash plus `{ operation, resource, canonicalPayloadHash, tenantId, targetId, targetVersion, expiresAt, consumedAt }`. `consume` validates expiry, bindings, and empty `consumedAt`, then marks the record consumed before the Xero mutation. Inject `Clock` and `RandomBytes` for deterministic tests.

For preview updates/deletes, fetch and require status `DRAFT`; capture `adapter.getVersion(record)`. For apply updates/deletes, fetch again, require `DRAFT`, and require the same version. For create, add `status: "DRAFT"` after parsing and derive an idempotency key from the stored token hash.

- [ ] **Step 4: Run the focused tests, then the complete unit suite**

Run: `npm test -- src/drafts/confirmation-store.test.ts src/drafts/draft-command-service.test.ts && npm test`

Expected: PASS for valid tokens and all invalid cases: expired, tampered, reused, resource-mismatched, payload-mismatched, non-draft, and version-conflicted.

- [ ] **Step 5: Commit draft safety**

```bash
git add src/drafts/confirmation-store.ts src/drafts/confirmation-store.test.ts src/drafts/draft-command-service.ts src/drafts/draft-command-service.test.ts
git commit -m "feat: require preview confirmation for draft changes"
```

### Task 5: Register invoices and credit notes as draft-only resources

**Files:**
- Create: `src/xero/draft-adapters/invoice.ts`, `src/xero/draft-adapters/credit-note.ts`, `src/xero/draft-adapters/invoice.test.ts`, `src/xero/draft-adapters/credit-note.test.ts`, `src/drafts/resource-registry.ts`, `src/drafts/resource-registry.test.ts`
- Modify: `src/handlers/create-xero-invoice.handler.ts`, `src/handlers/update-xero-invoice.handler.ts`, `src/handlers/create-xero-credit-note.handler.ts`, `src/handlers/update-xero-credit-note.handler.ts`
- Delete: the four modified legacy handlers after their adapter behavior is covered

**Interfaces:**
- Produces resource kinds `invoice` and `credit_note`.
- `getStatus` returns the Xero `status`; `getVersion` returns `updatedDateUTCString ?? updatedDateUTC?.toISOString() ?? id`.
- `create` calls the Xero SDK with its idempotency key parameter; `update` and `delete` send `status: "DRAFT"` and `status: "DELETED"` only through the command service after verified draft state.

- [ ] **Step 1: Write failing adapter/registry tests**

```ts
it("forces a new bill to DRAFT and passes the confirmation-derived idempotency key", async () => {
  await invoiceAdapter.create({ ...invoicePayload, type: "ACCPAY", status: "DRAFT" }, "idem-1");
  expect(sdk.createInvoices).toHaveBeenCalledWith("tenant", expect.objectContaining({ invoices: [expect.objectContaining({ status: "DRAFT" })] }), true, undefined, "idem-1", expect.anything());
});

it("exposes only registered draft resources", () => {
  expect(registry.get("payment")).toBeUndefined();
  expect(registry.get("invoice")?.kind).toBe("invoice");
});
```

- [ ] **Step 2: Run the tests and verify both fail before the adapters exist**

Run: `npm test -- src/xero/draft-adapters/invoice.test.ts src/xero/draft-adapters/credit-note.test.ts src/drafts/resource-registry.test.ts`

Expected: FAIL with missing adapter and registry modules.

- [ ] **Step 3: Implement adapters and central allow-list registration**

Port payload mapping from the existing invoice/credit-note handlers but remove default due dates and all caller-controlled status fields. Support `ACCREC` and `ACCPAY` invoices and both Xero credit-note types. The delete adapter must use the SDK operation documented for that resource to set `DELETED`; no physical HTTP DELETE is invented when Xero models deletion as a status update.

Register adapters through:

```ts
export function createDraftResourceRegistry(api: XeroApi): DraftResourceRegistry {
  return new DraftResourceRegistry([createInvoiceAdapter(api), createCreditNoteAdapter(api)]);
}
```

- [ ] **Step 4: Run the adapter, service, and registry tests**

Run: `npm test -- src/xero/draft-adapters/invoice.test.ts src/xero/draft-adapters/credit-note.test.ts src/drafts/resource-registry.test.ts src/drafts/draft-command-service.test.ts`

Expected: PASS. A non-draft invoice or credit note cannot reach `update` or `delete`.

- [ ] **Step 5: Commit the first resource set**

```bash
git add src/xero/draft-adapters src/drafts/resource-registry.ts src/drafts/resource-registry.test.ts src/handlers
git commit -m "feat: add confirmed invoice and credit note drafts"
```

### Task 6: Add quotes and purchase orders to the draft registry

**Files:**
- Create: `src/xero/draft-adapters/quote.ts`, `src/xero/draft-adapters/purchase-order.ts`, `src/xero/draft-adapters/quote.test.ts`, `src/xero/draft-adapters/purchase-order.test.ts`
- Modify: `src/drafts/resource-registry.ts`, `src/drafts/resource-registry.test.ts`
- Delete: `src/handlers/create-xero-quote.handler.ts`, `src/handlers/update-xero-quote.handler.ts`

**Interfaces:**
- Adds resource kinds `quote` and `purchase_order` to `createDraftResourceRegistry`.
- Quote and purchase-order update/delete calls retain line-item IDs when supplied and reject every status except `DRAFT` in `DraftCommandService`.

- [ ] **Step 1: Write failing quote/purchase-order adapter tests**

```ts
it("creates a DRAFT quote and sends no SENT status", async () => {
  await quoteAdapter.create({ contactId: "contact-1", date: "2026-08-09", lineItems: [{ description: "Consulting" }], status: "DRAFT" }, "idem-2");
  expect(sdk.createQuotes).toHaveBeenCalledWith("tenant", expect.objectContaining({ quotes: [expect.objectContaining({ status: "DRAFT" })] }), true, "idem-2", expect.anything());
});

it("rejects a SENT purchase order before the adapter update call", async () => {
  await expect(service.preview({ operation: "update", resource: "purchase_order", targetId: "po-1", payload: purchaseOrderPayload }))
    .rejects.toMatchObject({ code: "NOT_DRAFT" });
});
```

- [ ] **Step 2: Run the focused tests and verify the adapters are absent**

Run: `npm test -- src/xero/draft-adapters/quote.test.ts src/xero/draft-adapters/purchase-order.test.ts`

Expected: FAIL with missing adapter modules.

- [ ] **Step 3: Implement the two adapters and register them**

Use `xero-node` quote and purchase-order operations. The adapter accepts only document fields valid while DRAFT; it does not accept status transition values. Preserve `lineItemID` when supplied to prevent Xero from deleting/recreating that line on update. Add both adapters to the registry constructor in a deterministic order: invoice, credit_note, quote, purchase_order.

- [ ] **Step 4: Run all resource registry and service tests**

Run: `npm test -- src/xero/draft-adapters/quote.test.ts src/xero/draft-adapters/purchase-order.test.ts src/drafts/resource-registry.test.ts src/drafts/draft-command-service.test.ts`

Expected: PASS. Create is always DRAFT, while SENT/ACCEPTED/DELETED targets are rejected before mutations.

- [ ] **Step 5: Commit draft quotes and purchase orders**

```bash
git add src/xero/draft-adapters/quote.ts src/xero/draft-adapters/purchase-order.ts src/xero/draft-adapters/quote.test.ts src/xero/draft-adapters/purchase-order.test.ts src/drafts/resource-registry.ts src/drafts/resource-registry.test.ts src/handlers
git commit -m "feat: add confirmed quote and purchase order drafts"
```

### Task 7: Add manual journals to the draft registry

**Files:**
- Create: `src/xero/draft-adapters/manual-journal.ts`, `src/xero/draft-adapters/manual-journal.test.ts`
- Modify: `src/drafts/resource-registry.ts`, `src/drafts/resource-registry.test.ts`
- Delete: `src/handlers/create-xero-manual-journal.handler.ts`, `src/handlers/update-xero-manual-journal.handler.ts`

**Interfaces:**
- Adds the `manual_journal` registry entry.
- Manual journal creation/update must force `DRAFT` and never accept a posted status.

- [ ] **Step 1: Write failing manual-journal lifecycle tests**

```ts
it("does not update a POSTED manual journal", async () => {
  await expect(service.preview({ operation: "update", resource: "manual_journal", targetId: "journal-1", payload: manualJournalPayload }))
    .rejects.toMatchObject({ code: "NOT_DRAFT" });
});
```

- [ ] **Step 2: Run focused tests and verify the adapters are absent**

Run: `npm test -- src/xero/draft-adapters/manual-journal.test.ts`

Expected: FAIL with missing adapter modules.

- [ ] **Step 3: Implement and register the adapters**

Map the existing handler fields into adapter payloads, force `DRAFT`, and use only documented draft deletion semantics. Do not carry forward optional status arguments, the upstream tracking-category comment, or default side-effecting dates. Add tests for all returned status/version extractors. Do not register bank transactions: their documented status model has no `DRAFT` value.

- [ ] **Step 4: Run focused tests and full draft-resource regression suite**

Run: `npm test -- src/xero/draft-adapters/manual-journal.test.ts src/drafts`

Expected: PASS. The registry lists exactly five resource kinds at this point and all status checks happen before mutation.

- [ ] **Step 5: Commit the remaining accounting draft adapters**

```bash
git add src/xero/draft-adapters/manual-journal.ts src/xero/draft-adapters/manual-journal.test.ts src/drafts/resource-registry.ts src/drafts/resource-registry.test.ts src/handlers
git commit -m "feat: add confirmed manual journal drafts"
```

### Task 8: Add repeating-invoice templates and receipts to the draft registry

**Files:**
- Create: `src/xero/draft-adapters/repeating-invoice.ts`, `src/xero/draft-adapters/receipt.ts`, `src/xero/draft-adapters/repeating-invoice.test.ts`, `src/xero/draft-adapters/receipt.test.ts`
- Modify: `src/drafts/resource-registry.ts`, `src/drafts/resource-registry.test.ts`, `README.md`

**Interfaces:**
- Adds `repeating_invoice` and `receipt` resource kinds.
- Receipt registration is enabled only when `XERO_ENABLE_DEPRECATED_RECEIPTS=true`; its default is false.

- [ ] **Step 1: Write failing repeating-invoice and receipt tests**

```ts
it("creates a repeating invoice template in DRAFT status", async () => {
  await repeatingInvoiceAdapter.create({ ...repeatingInvoicePayload, status: "DRAFT" }, "idem-4");
  expect(sdk.createRepeatingInvoices).toHaveBeenCalledWith("tenant", expect.objectContaining({ repeatingInvoices: [expect.objectContaining({ status: "DRAFT" })] }), true, "idem-4", expect.anything());
});

it("does not register deprecated receipts unless explicitly enabled", () => {
  expect(createDraftResourceRegistry(api, { enableDeprecatedReceipts: false }).get("receipt")).toBeUndefined();
  expect(createDraftResourceRegistry(api, { enableDeprecatedReceipts: true }).get("receipt")?.kind).toBe("receipt");
});
```

- [ ] **Step 2: Run focused tests and verify the adapters are absent**

Run: `npm test -- src/xero/draft-adapters/repeating-invoice.test.ts src/xero/draft-adapters/receipt.test.ts`

Expected: FAIL with missing adapter modules.

- [ ] **Step 3: Implement and register the remaining draft-capable SDK resources**

Use the generated `xero-node` `createRepeatingInvoices`, `updateRepeatingInvoice`, `createReceipt`, and `updateReceipt` methods. Set status to `DRAFT` at the adapter boundary; model deletion through the documented `DELETED` status update only after `DraftCommandService` verifies a DRAFT target. Document receipt deprecation and the enabling environment variable in README.

- [ ] **Step 4: Run resource and safety regression tests**

Run: `npm test -- src/xero/draft-adapters/repeating-invoice.test.ts src/xero/draft-adapters/receipt.test.ts src/drafts`

Expected: PASS. The fully enabled registry contains exactly seven resource kinds; the default registry contains six and excludes receipts.

- [ ] **Step 5: Commit the final draft resource set**

```bash
git add src/xero/draft-adapters/repeating-invoice.ts src/xero/draft-adapters/receipt.ts src/xero/draft-adapters/repeating-invoice.test.ts src/xero/draft-adapters/receipt.test.ts src/drafts/resource-registry.ts src/drafts/resource-registry.test.ts README.md
git commit -m "feat: add confirmed recurring invoice and receipt drafts"
```

### Task 9: Expose preview/apply tools and remove unsafe legacy write tools

**Files:**
- Create: `src/mcp/draft-tools.ts`, `src/mcp/draft-tools.test.ts`, `src/mcp/tool-result.ts`
- Modify: `src/mcp/server.ts`, `src/tools/tool-factory.ts`
- Delete: `src/tools/create`, `src/tools/update`, `src/tools/delete`, `src/helpers/create-xero-tool.ts`, `src/types/tool-definition.ts`, `src/types/tool-list.ts`

**Interfaces:**
- Produces six generic tool names: `xero_draft_preview_create`, `xero_draft_create`, `xero_draft_preview_update`, `xero_draft_update`, `xero_draft_preview_delete`, `xero_draft_delete`.
- Preview inputs use `{ resource: DraftResourceKind, payload: unknown, targetId?: string }`; apply inputs use `{ confirmationToken: string }`.
- Produces `toToolResult(value): CallToolResult` with text plus structured content when supported.

- [ ] **Step 1: Write failing tool-catalogue tests**

```ts
it("lists draft preview tools but never a direct invoice mutation tool", async () => {
  const tools = await listTools(server);
  expect(tools).toContain("xero_draft_preview_create");
  expect(tools).toContain("xero_draft_create");
  expect(tools).not.toContain("create-invoice");
  expect(tools).not.toContain("approve-payroll-timesheet");
});

it("returns a preview token without calling Xero", async () => {
  const result = await callTool(server, "xero_draft_preview_create", { resource: "invoice", payload: invoicePayload });
  expect(result.structuredContent.confirmationToken).toEqual(expect.any(String));
  expect(api.createCalls).toHaveLength(0);
});
```

- [ ] **Step 2: Run the focused test and verify missing tool definitions**

Run: `npm test -- src/mcp/draft-tools.test.ts`

Expected: FAIL because `draft-tools.js` does not exist.

- [ ] **Step 3: Register generic safe tools and delete direct write registrations**

Define input schemas with Zod and return result objects with `content: [{ type: "text", text: summary }]` plus `structuredContent`. The tool handler obtains services from `ServerDependencies`; it must never capture a module-global API client. Delete the legacy create/update/delete folders and remove their imports from `ToolFactory`.

- [ ] **Step 4: Run tool, transport, and full tests**

Run: `npm test -- src/mcp/draft-tools.test.ts src/transports/http.test.ts && npm test && npm run typecheck`

Expected: PASS. Tool discovery is deterministic and no old direct mutation tool remains.

- [ ] **Step 5: Commit the safe tool surface**

```bash
git add src/mcp src/tools src/helpers src/types
git commit -m "feat: expose preview-confirmed draft tools"
```

### Task 10: Port read tools behind the new MCP result boundary

**Files:**
- Create: `src/mcp/read-tools.ts`, `src/mcp/read-tools.test.ts`, `src/mcp/read-tools.snapshot.test.ts`
- Modify: `src/mcp/server.ts`, `src/tools/list/index.ts`, `src/tools/get/index.ts`, all `src/tools/list/*.tool.ts`, all `src/tools/get/*.tool.ts`
- Delete: `src/tools/tool-factory.ts` after server registration is moved

**Interfaces:**
- Produces `registerReadTools(server: McpServer, dependencies: ServerDependencies): void`.
- Retains read-only capability names as `xero_list_*` and `xero_get_*`; documents renamed legacy names in README.
- Every handler returns `CallToolResult` through `toToolResult` and maps Xero failures through a non-secret error result.

- [ ] **Step 1: Write failing read-tool contract tests and a snapshot**

```ts
it("keeps reports and accounting list tools read-only", async () => {
  const tools = await listTools(server);
  expect(tools).toContain("xero_list_invoices");
  expect(tools).toContain("xero_list_profit_and_loss");
  expect(tools.filter((name) => /create|update|delete|approve|revert/.test(name))).toEqual([]);
});

it("returns a redacted error when a read adapter fails", async () => {
  api.listInvoices.mockRejectedValueOnce(new Error("Bearer token-value"));
  const result = await callTool(server, "xero_list_invoices", {});
  expect(text(result)).toContain("Xero request failed");
  expect(text(result)).not.toContain("token-value");
});
```

- [ ] **Step 2: Run tests and verify they fail because the registration function is missing**

Run: `npm test -- src/mcp/read-tools.test.ts src/mcp/read-tools.snapshot.test.ts`

Expected: FAIL with missing `read-tools.js`.

- [ ] **Step 3: Port each existing list/get tool in deterministic alphabetical order**

Move schema/handler pairs from `src/tools/list` and `src/tools/get` into `registerReadTools`, retaining only operations supported by the current Xero SDK. Reuse the existing list handlers only after refactoring them to accept injected `XeroApi`; remove payroll mutation commands entirely. Generate and approve a snapshot of the final `tools/list` names, descriptions, and input JSON schemas.

- [ ] **Step 4: Run read contract, snapshot, lint, typecheck, and full tests**

Run: `npm test -- src/mcp/read-tools.test.ts src/mcp/read-tools.snapshot.test.ts && npm run lint && npm run typecheck && npm test`

Expected: PASS. The snapshot contains read tools and the six draft workflow tools only.

- [ ] **Step 5: Commit read-tool migration**

```bash
git add src/mcp/read-tools.ts src/mcp/read-tools.test.ts src/mcp/read-tools.snapshot.test.ts src/mcp/server.ts src/tools
git commit -m "feat: port read-only tools to MCP v2"
```

### Task 11: Add scenario evaluations, CI, documentation, and work tracking

**Files:**
- Create: `evals/draft-scenarios.jsonl`, `src/evals/draft-scenarios.test.ts`, `.github/workflows/ci.yml`, `docs/requirements-traceability.md`, `docs/operations.md`
- Modify: `README.md`, `docs/PRD.md`

**Interfaces:**
- Each JSONL line conforms to `{ id: string; prompt: string; expectedTools: string[]; expectedOutcome: "success" | "blocked"; forbiddenTools: string[] }`.
- Produces `evaluateScenario(scenario, server): Promise<EvaluationResult>`.

- [ ] **Step 1: Write failing evaluation tests for the safety scenarios**

```ts
it("blocks an attempt to authorise an invoice", async () => {
  const scenario = scenarioById("invoice-authorisation-is-blocked");
  const result = await evaluateScenario(scenario, server);
  expect(result.outcome).toBe("blocked");
  expect(result.calledTools).not.toContain("xero_draft_create");
});

it("requires preview before a draft invoice apply", async () => {
  const scenario = scenarioById("create-sales-invoice-draft");
  const result = await evaluateScenario(scenario, server);
  expect(result.calledTools).toEqual(["xero_draft_preview_create", "xero_draft_create"]);
});
```

- [ ] **Step 2: Run the test and verify the evaluator is missing**

Run: `npm test -- src/evals/draft-scenarios.test.ts`

Expected: FAIL with missing evaluator/module errors.

- [ ] **Step 3: Add the deterministic offline eval suite and CI gates**

Add scenarios: `create-sales-invoice-draft`, `update-supplier-bill-draft`, `delete-credit-note-draft`, `invoice-authorisation-is-blocked`, `authorised-credit-note-update-is-blocked`, `reused-confirmation-token-is-blocked`, and `create-retry-is-idempotent`. The evaluator uses fake tool calls and the fake Xero API, not an LLM or a live tenant.

Create CI with Node 22 and commands in this exact order: `npm ci`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm test`, `npm run test:eval`. In `docs/requirements-traceability.md`, map every PRD requirement to a stable requirement ID (`MCP-01`, `AUTH-01`, `DRAFT-01` through `DRAFT-07`, `EVAL-01`), source module, and test file; add the linked GitHub Issue URL when that issue is created. `docs/operations.md` documents environment variables, HTTP route, stdio command, token TTL, log redaction, and a sandbox-only cleanup policy.

- [ ] **Step 4: Run the entire local release gate**

Run: `npm ci && npm run typecheck && npm run lint && npm run build && npm test && npm run test:eval`

Expected: PASS. The output demonstrates all seven scenarios and does not contain a secret, access token, refresh token, or authorization header.

- [ ] **Step 5: Commit release controls and create tracking issues**

```bash
git add evals src/evals .github/workflows/ci.yml docs README.md
git commit -m "test: add draft safety evaluations and CI"
gh label create protocol --color 1D76DB --description "MCP protocol and transport work"
gh label create draft-write --color FBCA04 --description "Draft-only Xero mutation work"
gh label create security --color D73A4A --description "Safety, token, and secret handling"
gh label create read-tools --color 0E8A16 --description "Read-only Xero tools"
gh label create bug --color B60205 --description "Incorrect behaviour"
gh label create docs --color 0075CA --description "Documentation and tracking"
gh project create --owner startsomethingbig --title "Xero MCP Modernisation"
gh issue create --title "Migrate MCP server to 2026-07-28" --label protocol --body-file docs/PRD.md
gh issue create --title "Add preview-confirmed draft mutations" --label draft-write --body-file docs/PRD.md
gh issue create --title "Add draft safety evaluation suite" --label security --body-file docs/requirements-traceability.md
```

## Plan Self-Review

- **Spec coverage:** Tasks 1–2 cover the protocol and both transports; Task 3 covers explicit single-tenant configuration and secret handling; Tasks 4 and 9 implement the preview-confirm draft boundary; Tasks 5–8 enumerate every current SDK resource with a documented draft lifecycle; Task 10 preserves reads; Task 11 covers scenario evaluation, CI, operations, and requirements tracking.
- **Scope:** The plan explicitly excludes multi-tenant OAuth, bulk writes, and every non-draft state change.
- **Type consistency:** `XeroApi` is injected into every adapter; `DraftResourceAdapter` is registered once; tools call `DraftCommandService`; only that service applies mutations.
