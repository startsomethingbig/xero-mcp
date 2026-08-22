# Xero MCP Server

## Stack

- Node.js 22+ with TypeScript 5.9, ESM, and strict compiler settings.
- MCP TypeScript SDK v2: `@modelcontextprotocol/server`, `@modelcontextprotocol/node`, and `@modelcontextprotocol/client`.
- MCP protocol target: `2026-07-28`, exposed through stateless HTTP at `POST /mcp` and stdio.
- Xero integration: `xero-node` with one configured tenant (`XERO_TENANT_ID`).
- Validation: Zod 3. Testing: Vitest 4. Linting: ESLint 9. Formatting: Prettier. Development runner: `tsx`.

## Commands

```bash
npm install
npm run dev -- stdio
npm run dev -- http
npm test
npm run test:eval
npm run typecheck
npm run lint
npm run build
```

Run the release gate before claiming completion:

```bash
npm run typecheck && npm run lint && npm run build && npm test && npm run test:eval
```

## Safety rules

- Never log Xero tokens, client secrets, or complete authorization headers; route every error message through `redactErrorMessage` / `formatError`.
- HTTP mode requires `MCP_AUTH_TOKEN` and binds loopback by default. Never bind a non-loopback interface without the token, and never treat Host/Origin validation as authentication.
- Build `ServerDependencies` once in `main()` and hand the same object to every per-request server; never construct a `ConfirmationStore` or `DraftCommandService` inside the server factory.
- Read-tool inputs use the shared constrained schemas in `src/tools/schemas.ts`; never interpolate caller values into a Xero `where` filter except through `src/helpers/xero-where.ts`.
- Use the injected `XeroApi` boundary; do not add module-global Xero clients to new code.
- Xero mutations are draft-only and must flow through preview → single-use confirmation → apply. No direct write tool is permitted.
- Always re-fetch update/delete targets and reject any status other than `DRAFT` before a mutation call.
- Do not add bank-transaction draft tools: Xero bank transactions have no `DRAFT` state.
- Keep deprecated receipt support opt-in and require its documented legacy Xero scope.

## Development workflow

- Follow test-driven development: write and run a focused failing test before production code, then run it green.
- Keep tools deterministic and schemas explicit.
- Make small, focused commits and leave unrelated workspace changes untouched.
