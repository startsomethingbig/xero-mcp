# Xero MCP 2026-07-28 Modernisation Design

**Status:** Proposed for review  
**Companion PRD:** [`docs/PRD.md`](../../PRD.md)

## Decision

Fork `XeroAPI/xero-mcp-server` into `startsomethingbig/xero-mcp`, retain the TypeScript/Xero API domain adapters that remain compatible with current Xero dependencies, and replace the legacy MCP server layer. The result is a single-tenant server implementing MCP `2026-07-28` over stateless HTTP and stdio.

## Architecture

```text
MCP client ── HTTP /mcp ──┐
                          ├─ MCP v2 server / tool catalogue
MCP client ── stdio ──────┘             │
                                        ├─ read-tool adapters ── Xero client ── Xero API
                                        └─ draft command service
                                               ├─ resource registry
                                               ├─ preview validator
                                               └─ confirmation-token store
```

The transport layer owns protocol compliance only. Tool registration delegates to independent read and draft-command adapters. The draft-command service is the sole code path permitted to call a Xero mutation endpoint; the Xero client must not be exposed directly to tools.

## Protocol and transport

- Use the maintained TypeScript MCP SDK v2 line, which supports `2026-07-28`.
- Serve stateless Streamable HTTP on `POST /mcp`; each request is self-contained and carries the protocol metadata required by the SDK/specification.
- Support `server/discover` rather than legacy initialization. Do not rely on `Mcp-Session-Id`, sticky sessions, legacy HTTP+SSE, roots, sampling, or logging capabilities.
- Provide a separate stdio bootstrap that uses the same tool registration and service graph. It is a delivery transport, not a distinct capability set.
- Keep tool registration ordered deterministically and publish cache metadata if offered by the selected SDK.

## Single-tenant authentication

Configuration is read once at startup from environment variables. It provides the Xero client credentials, refresh-token workflow values, and one tenant ID. Configuration parsing redacts values in all thrown errors. The Xero client owns token refresh and attaches the tenant ID only inside API calls.

Remote multi-user OAuth is deliberately excluded. It would require encrypted persistence, callbacks, session/user correlation, key rotation, consent management, and a different threat model.

## Draft safety model

`DraftResourceDefinition` is a central registry entry containing the resource kind, its Xero status field, allowable create/update/delete adapter functions, validation schema, and documented draft lifecycle. A resource becomes available only when all three checks hold:

1. the current Xero SDK has the endpoint;
2. Xero documentation says the resource supports `DRAFT`; and
3. the intended action is legal while it remains a draft.

This closes the main safety failure mode: adding a convenient generic write adapter accidentally enables non-draft accounting mutations.

### Two-step operations

Each resource yields four tool families:

- `xero_<resource>_preview_create`
- `xero_<resource>_create_draft`
- `xero_<resource>_preview_update` and `xero_<resource>_update_draft`
- `xero_<resource>_preview_delete` and `xero_<resource>_delete_draft`

The preview normalises input, sets/validates `status: DRAFT`, and constructs a signed, opaque confirmation token containing a digest of the canonical operation, target identifier/version, tenant ID, expiry, nonce, and resource type. It persists only the nonce/digest state needed to enforce single use. Previews never call a mutation endpoint.

The apply operation verifies the token, atomically marks the nonce used, re-checks the target status/version for updates and deletes, and makes the Xero call. It sends the token-derived idempotency key for creations. Any token-validation or draft-state failure returns an error before a mutation call.

For the initial single-instance release, the confirmation store is in memory with a short configurable TTL. HTTP deployments with multiple replicas must use a shared atomic store before scaling beyond one replica; the server must fail startup if configured for more than one replica without it.

## Read migration

Port existing upstream read tools incrementally behind a common result mapper and Zod/JSON-schema boundary. Preserve compatible names where safe; document any renamed tools and provide stable human descriptions. Read-only data may support structured MCP output, but the implementation must remain usable by clients that consume text content only.

## Errors and observability

Define explicit error classes for configuration, authentication, authorization, input validation, unsupported draft resource, invalid draft state, confirmation, Xero conflict, and upstream failure. The MCP boundary maps these consistently to `isError` results. Logs contain metadata only: request ID, tool, resource kind, record ID, outcome, and error class.

## Evaluation baseline

The suite is version-controlled and runs without live credentials.

| Layer | Fixture or evaluator | Required assertions |
| --- | --- | --- |
| Protocol | MCP v2 in-process client against HTTP and stdio | discovery works; no legacy initialize/session dependency; tool catalogue is deterministic |
| Tool contract | checked-in tools/list snapshot and schema checks | every tool has valid JSON schema, clear description, and declared draft boundary |
| Draft unit | fake Xero client plus deterministic clock/token provider | preview never mutates; valid token applies once; expired/tampered/reused/mismatched token fails |
| Lifecycle contract | per-resource Xero response fixtures | create forces DRAFT; update/delete fetch then reject every non-DRAFT status; version conflict is rejected |
| Scenario eval | JSONL prompts with expected tool sequence/outcome | agent asks to create/update/delete a draft; attempted approval/payment/non-draft change is denied |
| Regression | full test, typecheck, lint, build in CI | all gates pass on every pull request |

Scenario examples include: create a customer invoice; amend an invoice draft; delete a supplier bill draft; attempt to authorise an invoice; attempt to modify an authorised credit note; reuse a confirmation token; and retry a successful create. The first three must require preview then apply; the next three must fail before a Xero write; the retry must not duplicate a record.

An optional nightly integration suite may run against a dedicated Xero demo/sandbox tenant with credentials stored only in CI secrets. It must create uniquely tagged drafts and delete only those tagged drafts in cleanup; it is not a prerequisite for local development.

## Rollout and compatibility

The repository begins on a dedicated `modernise-mcp-2026` branch. Existing stdio users receive a migration note and an explicit compatibility statement: the new server is designed for MCP `2026-07-28`, and draft-write tool names are intentionally safety-oriented. No legacy stateful HTTP endpoint is retained.

## Design review

This document contains no placeholders. It is deliberately scoped to one tenant and draft-only lifecycle operations; multi-tenant OAuth, non-draft changes, and bulk operations remain separate future projects.
