# Task 7 report: manual-journal draft adapter

## Red

The first focused test run was:

```text
npm test -- src/xero/draft-adapters/manual-journal.test.ts
```

It exited 1 before any test executed because
`src/xero/draft-adapters/manual-journal.ts` did not exist. The import error was
the expected missing-adapter failure.

## Green

The requested focused regression suite now passes:

```text
npm test -- src/xero/draft-adapters/manual-journal.test.ts src/drafts
```

Result: 4 test files, 28 tests passed.

Manual-journal coverage proves:

- creation maps the legacy handler's editable fields and sends the provided
  idempotency key;
- creation and update force `status: "DRAFT"`;
- the payload schema strips caller-controlled status, IDs, and calculated
  fields;
- deletion delegates to the Xero boundary's documented draft deletion path;
- a `POSTED` target is rejected with `NOT_DRAFT` during preview, before an
  update mutation can occur; and
- ID, status, and all version fallback extractors are correct.

## Implementation

- Added injected `createManualJournalAdapter(api)` and registered its
  `manual_journal` resource kind after the four existing draft resources.
- Payloads allow-list the editable manual-journal fields from the legacy
  handlers: narration, journal lines, date, line-amount type, URL, and
  cash-basis reporting flag. No side-effecting default date or tracking
  category behavior was retained.
- Removed the deprecated globally coupled create/update manual-journal
  handlers.
- The registry intentionally does not register `bank_transaction`, since its
  documented state model has no `DRAFT` status.
- No Task 8 public tools or generic preview/apply MCP tools were implemented
  or changed.

## Verification

| Check | Result |
| --- | --- |
| First focused adapter run | Exit 1 as expected: missing `manual-journal.js` module. |
| `npm test -- src/xero/draft-adapters/manual-journal.test.ts src/drafts` | Exit 0; 4 files, 28 tests passed. |
| `npm test -- src/xero/draft-adapters` | Exit 0; 5 files, 32 tests passed. |
| `npm run lint` | Exit 0; no diagnostics. |
| `npx prettier --check` on Task 7 source/tests/registry files | Exit 0; all matched Prettier style. |
| `git diff --check` | Exit 0; no whitespace errors. |
| `npm run typecheck` | Expected exit 1: Task 8 legacy manual-journal tool wrappers still import the intentionally deleted handlers. No Task 7 adapter/test diagnostic remains. |

## Scope and handoff

The typecheck failure must be resolved by Task 8 when it replaces or removes
the legacy manual-journal tool wrappers. This task deliberately does not alter
those tools, per its scope boundary.
