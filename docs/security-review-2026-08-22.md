# Security review — Xero MCP server (MCP 2026-07-28 branch)

**Date:** 2026-08-22
**Scope:** `modernise-mcp-2026` at `77abe81` — MCP TypeScript SDK v2.0.0, protocol `2026-07-28`, stateless HTTP `POST /mcp` + stdio, draft confirmation service, five draft adapters, ported read tools.
**Method:** three independent read-only passes (transport and SDK internals; draft-safety and token core; legacy surface, secrets and input flows), each finding re-verified by reading the code or running a read-only check (`tsc --noEmit`, greps in `node_modules`). Requirements cross-checked against the MCP 2026-07-28 Streamable HTTP specification (Origin validation **MUST**; loopback binding and authentication **SHOULD**).

## Framing

At `77abe81` the served MCP server registered **no tools** (`createXeroMcpServer` returned a bare `McpServer`), so nothing below was exploitable over the wire on that commit. Every transport and draft-safety finding would have gone live with the next step of the modernisation plan (exposing tools), which is why they were fixed first. The branch also failed `tsc --noEmit` (three errors from orphaned legacy write tools).

## Findings and status

| # | Severity | Finding | Status | Proof |
|---|----------|---------|--------|-------|
| S1 | Critical | `POST /mcp` had no authentication and bound all interfaces; Host/Origin checks are DNS-rebinding guards that `curl -H 'Host: localhost'` satisfies. | **Fixed** — required `MCP_AUTH_TOKEN` bearer (constant-time), 401 before any body read, loopback bind by default, startup line on stderr. | `src/transports/http.test.ts` "bearer authentication" suite; `src/index.test.ts` binds `127.0.0.1` |
| S2 | High | One env var fed both Host and Origin allowlists; `*` became a literal allowed hostname; `host:port` entries parsed to `""`. | **Fixed** — separate `MCP_ALLOWED_HOSTS` / `MCP_ALLOWED_ORIGINS`, wildcards rejected at startup and ignored in the transport, entries normalised to hostnames. | `environment.test.ts` "network settings"; `http.test.ts` host/origin separation and wildcard tests |
| S3 | High | Per-request server factory vs in-memory confirmation state; `XERO_CONFIRMATION_SECRET` required but unused. | **Fixed** — typed `ServerDependencies` built once in `main()` (`createServerDependencies`); store hashes tokens with HMAC keyed by the secret. | `http.test.ts` "hands the same dependencies to every per-request server"; `dependencies.test.ts`; `confirmation-store.test.ts` "secret" |
| S4 | High | Build broken (orphaned imports); 19 legacy direct-write tools + 17 mutation handlers still in tree. | **Fixed** — legacy write tree deleted; tool-catalogue contract test over a real 2026-07-28 client. | `src/mcp/server.test.ts`; `npm run typecheck` |
| S5 | High | `ensureError` JSON-stringified xero-node rejections (which carry `Authorization`) into tool output. | **Fixed** — helper and its four callers removed with S4. | — (code removed) |
| S6 | Medium | Xero `where` filter injection via `reference` / `invoiceNumber` / IDs in list-payments, credit-notes, bank-transactions. | **Fixed** — `guidFilter` / `stringFilter` validate (UUID; no quotes, backslashes, control chars); tool schemas enforce the same. | `src/helpers/xero-where.test.ts`; `src/handlers/list-xero-payments.handler.test.ts`; `src/tools/schemas.test.ts` |
| S7 | Medium | Unknown `operation` minted a token and apply's ternary routed it to `adapter.delete`. | **Fixed** — operation validated at preview; exhaustive `switch` at apply. | `draft-command-service.test.ts` "rejects an unknown operation" |
| S8 | Medium | `getVersion` fell back to the record ID (constant across edits); `updatedDateUTCString` branch was dead (field absent in xero-node 13.3.0). | **Fixed** — adapters return only a real `UpdatedDateUTC`; service refuses to preview/apply without one (`VERSION_UNAVAILABLE`). | adapter tests (`getVersion … toBeUndefined`); service tests "no version" |
| S9 | Medium | Unbounded HTTP request body (SDK has no limit). | **Fixed** — `content-length` pre-check + counted stream read, 413, configurable `MCP_MAX_BODY_BYTES`. | `http.test.ts` "request body limit" |
| S10 | Medium | `pending` (full payloads) and store records never purged. | **Fixed** — swept on expiry, pending cleared on every apply outcome, store capped (`maxRecords`). | store "housekeeping" tests; service "drops pending state" / "sweeps expired previews" |
| S11 | Medium | Idempotency key derived from a token burned before the Xero call ⇒ duplicate draft after a timeout retry. | **Fixed** — key = `sha256(tenant, resource, canonical payload)`. *Deviation from PRD wording ("derived from the confirmation token"); the token-derived key could not protect the only retry that can actually happen.* | service "derives the create idempotency key from the operation" |
| S12 | Medium | `PORT=` / TTL `""` → `0` (ephemeral port on all interfaces / instantly expired tokens); `abc` → `NaN` → RangeError at first preview. | **Fixed** — strict bounded integer parsing; blank = unset. | `environment.test.ts` "numeric parsing" |
| S13 | Low | `RESOURCE_BINDINGS["constructor"]` truthy → bypassed unsupported-resource and receipt-delete guards, triggered a real token fetch; `XeroApi.create/update` enforced no DRAFT. | **Fixed** — `Object.hasOwn`; boundary refuses non-DRAFT payloads; token cached with single-flight. | `client.test.ts` prototype-key and DRAFT tests |
| S14 | Low | `apply` hashed unvalidated input; pending-miss path consumed foreign tokens. | **Fixed** — format check first; foreign tokens only inspected. | service "malformed tokens" / "does not consume a token it did not mint" |
| S15 | Low | Manual-journal `url` unvalidated (rendered as a link in Xero UI); numbers not finite; strings unbounded. | **Fixed** — https-only URL, `.finite()`, bounded strings/arrays. | adapter tests "https source-document links", "non-finite and oversized" |
| S16 | Low | Strict create schema ran after the token was consumed. | **Fixed** — `parsePayload(input, operation)` runs the create schema at preview. | service "validated strictly at preview"; adapter tests |
| S17 | Low | `main().catch` printed raw error objects; stdio handle/`onerror` dropped. | **Fixed** — `redactErrorMessage` everywhere; handle kept; SIGINT/SIGTERM shutdown; `dotenv` quiet. | `format-error.test.ts` "redactErrorMessage"; `index.test.ts`; `stdio.test.ts` |
| S18 | Low | Read-tool schemas: bare `z.string()` IDs, unbounded `page`, unvalidated dates. | **Fixed** — shared `src/tools/schemas.ts`; table-driven test over every registered tool. | `src/tools/schemas.test.ts` |
| S19 | Low | `axios` undeclared, `openid-client` unused, `dist/` never cleaned (stale write-tool JS shipped), `test:eval` pointed at a missing dir. | **Fixed** — `package.json` updated. | `npm run build`, `npm run test:eval` |
| S20 | Low | README documented `XERO_SCOPES` (unimplemented), bearer-only mode, ~50 tools, "HTTP not available". | **Fixed** — README/AGENTS/.env.example rewritten to match the code. | — |

## Verified clean (no change needed)

Token entropy (32 CSPRNG bytes, base64url) and hash-then-lookup (no timing oracle); single-use consumption is synchronous between check and mark; zod `z.object` strips unknown keys including nested arrays, `status` cannot be smuggled, `requireDraftPayload` double-checks; `"DRAFT"` string equality holds for all five xero-node status enums; `formatXeroError` is a constant; `formatError` is well hardened and tested; deep links cannot reach a non-Xero host; `get-package-version` reads a fixed path; no bank/tax/IRD/DOB fields reach tool output; browser CSRF is blocked (no CORS headers, 405 on OPTIONS, 415 on non-JSON).

## Noted, not fixed (outside security scope)

- `list-profit-and-loss` passes `paymentsOnly` into the `standardLayout` slot (financial correctness).
- `getExternalLink` percent-encodes whole URLs, so organisation links render as inert text (broken feature; accidentally safe).
- The bearer-only (`XERO_CLIENT_BEARER_TOKEN`) path still exists in the legacy client but can no longer start, because `loadEnvironment` requires client credentials and a tenant; decide whether to keep or delete it.
- `list-payroll-employees` description claims dates of birth that the formatter never emits.

## Residual risk and follow-ups

- The confirmation store is in-process. Behind more than one replica, single-use is per replica; the design already requires a shared atomic store before scaling, and `createServerDependencies` is the one place to swap it in.
- `MCP_AUTH_TOKEN` is a shared static secret, chosen over full OAuth 2.1 for this milestone. Put TLS in front of any non-loopback deployment; the server speaks plain HTTP.
- When read and draft tools are registered, update the expected tool list in `src/mcp/server.test.ts` deliberately — that test exists to make the attack surface a reviewed diff.
