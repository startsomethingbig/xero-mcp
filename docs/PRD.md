# Xero MCP Modernisation — Product Requirements Document

**Status:** Proposed for review  
**Repository:** `startsomethingbig/xero-mcp`  
**Protocol target:** Model Context Protocol `2026-07-28`

## Problem

The upstream Xero MCP server uses the legacy, session-based MCP SDK and exposes an inconsistent set of write tools. It cannot safely offer agents a complete workflow for preparing accounting documents as drafts.

## Goal

Deliver a modern, single-tenant Xero MCP server that supports the MCP `2026-07-28` protocol over both stateless HTTP and stdio, preserves useful read access, and permits only explicitly confirmed mutations to Xero resources that have a documented `DRAFT` lifecycle.

## Users and jobs

An authorised finance user or their agent can:

- inspect Xero accounting data and draft-capable records;
- prepare a new draft document, review the exact change, then create it;
- review and amend an existing draft document; and
- review and delete an existing draft document.

The server must never create, update, delete, approve, submit, authorise, void, pay, send, allocate, or otherwise transition a record beyond `DRAFT`.

## Functional requirements

1. **Protocol and transports**
   - Use a current TypeScript MCP SDK that implements MCP `2026-07-28`.
   - Expose stateless Streamable HTTP at `/mcp` and a stdio entry point.
   - HTTP requests must work without `initialize`, `initialized`, or session affinity.
   - Follow 2026-07-28 discovery, per-request metadata, standard headers, and deterministic/cacheable tool listing where supported by the SDK.

2. **Single-tenant Xero access**
   - Authenticate with a single Xero tenant configured using environment variables and OAuth credentials/tokens.
   - Never log access tokens, refresh tokens, client secrets, or complete `Authorization` headers.
   - Fail safely and descriptively when configuration, consent, scope, or tenant access is missing.

3. **Read tools**
   - Port the upstream read tools that are still supported by the current Xero SDK.
   - Use stable tool names and JSON Schema 2020-12-compatible input schemas.
   - Return structured content alongside a concise human-readable summary when the SDK/client supports it.

4. **Draft-only mutation tools**
   - Provide create, update, and delete operations for every SDK-exposed Xero resource whose documented lifecycle includes `DRAFT` and whose endpoint permits the requested operation while it is a draft.
   - The initial registry contains invoices (sales invoices and bills), credit notes, quotes, purchase orders, manual journals, repeating-invoice templates, and receipts. Receipts are supported only for Xero organisations that still have access to the deprecated classic expense-claims API. Bank transactions are explicitly excluded: Xero documents no `DRAFT` status for them. This list is not permission to mutate resources that lack a `DRAFT` lifecycle.
   - Force status `DRAFT` on create; reject a supplied status or action that is not exactly `DRAFT`.
   - Before update or delete, fetch the record and reject it unless its Xero status is exactly `DRAFT`.
   - Do not expose general write tools for contacts, payments, payroll, items, accounts, tracking configuration, or any other resource without a documented draft lifecycle.

5. **Preview then apply**
   - Every create, update, and delete starts with a preview tool that validates and normalises the intended payload without calling a Xero mutation endpoint.
   - The preview result returns the proposed operation, target record/version where relevant, normalised payload or deletion summary, expiry, and a cryptographically unguessable single-use confirmation token.
   - The matching apply tool accepts only that token. It must reject expired, already-used, tampered, operation-mismatched, tenant-mismatched, or payload-mismatched tokens.
   - An apply request must re-fetch an update/delete target and check that it remains `DRAFT`; update/delete previews include the record’s last-known version/timestamp to detect a changed target.
   - Create calls use an idempotency key derived from the confirmation token to prevent duplicate drafts after retries.

6. **Errors and auditability**
   - Map Xero validation and permission errors to actionable MCP tool errors without exposing secrets.
   - Emit structured audit logs with request ID, operation, resource kind, record ID (when available), result, and error class; never log financial payload contents by default.

## Non-goals

- Multi-tenant OAuth, hosted login/callback flows, durable token storage, or user management.
- Approval, payment, reconciliation, journal posting, sending, allocation, status transition, or non-draft mutations.
- Replacing Xero’s accounting validation rules or providing accounting advice.
- Bulk write operations in the first release.

## Feature sequence

| Feature | Outcome | Acceptance evidence |
| --- | --- | --- |
| MCP platform migration | 2026-07-28-compatible HTTP and stdio server | SDK protocol tests and HTTP header/request tests |
| Configuration and Xero client | Secure single-tenant client boundary | env validation and secret-redaction tests |
| Read compatibility | Ported, stable read tool catalogue | tool-list snapshot and mocked API contract tests |
| Draft resource registry | One authoritative list of safe resources/actions | registry unit tests against Xero lifecycle rules |
| Preview/confirmation | No direct write path exists | token lifecycle and no-mutation preview tests |
| Per-resource draft writes | All registry resources create/update/delete only as drafts | lifecycle fixtures for every registered action |
| Evaluation and CI | Regression protection | conformance, scenario, integration, lint/type/test gates |

## Success criteria

- A compliant client can discover and invoke tools through both supported transports using protocol `2026-07-28`.
- No mutation reaches Xero without a valid preview-issued confirmation token.
- Every registered write fixture demonstrates that `DRAFT` records can be created, updated, and deleted, and every non-draft fixture is rejected before mutation.
- Automated tests can prove that preview requests do not make HTTP mutation calls and that retries cannot create duplicate drafts.
- The project has a traceable requirement → issue → pull request → test-evidence path.

## Work tracking

The PRD is the product source of truth. Once approved, each feature-sequence row becomes a GitHub Issue with acceptance criteria, test evidence, and labels: `protocol`, `draft-write`, `security`, `read-tools`, `bug`, or `docs`. Issues move through a GitHub Project board (`Backlog`, `Ready`, `In progress`, `In review`, `Done`) and pull requests must link the relevant issue. A generated requirements-to-tests matrix remains in version control.
