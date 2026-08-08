# Task 6 report: quote and purchase-order draft adapters

## Red

The required first focused run was:

```text
npm test -- src/xero/draft-adapters/quote.test.ts src/xero/draft-adapters/purchase-order.test.ts
```

It exited 1. Both suites failed during import with zero tests executed because
`quote.js` and `purchase-order.js` did not yet exist. This was the expected
missing-feature failure before implementation.

## Green

The Task 6 focused suite, including the registry and reviewed command service,
finished with 27/27 tests passing. Coverage includes:

- quote and purchase-order registration alongside invoice and credit note;
- the deterministic registry order `invoice`, `credit_note`, `quote`,
  `purchase_order`;
- quote and purchase-order create calls routed through the matching `xero-node`
  SDK operations with confirmation-derived idempotency keys;
- forced `DRAFT` status on create and update;
- allow-listed editable draft fields with transition and calculated fields
  stripped;
- preservation of supplied `lineItemID` values on update;
- rejection of every non-DRAFT quote status (`SENT`, `DECLINED`, `ACCEPTED`,
  `INVOICED`, `DELETED`) before update or delete mutation;
- rejection of every non-DRAFT purchase-order status (`SUBMITTED`,
  `AUTHORISED`, `BILLED`, `DELETED`) before update or delete mutation; and
- Xero record identity, status, and version fallback behavior.

## Implementation

- `createQuoteAdapter(api)` and `createPurchaseOrderAdapter(api)` accept only an
  injected `XeroApi`; neither captures the deprecated global client.
- Both Zod payload schemas allow-list document fields valid while the record is
  editable as a draft. Status transitions, `sentToContact`, and calculated
  totals are not admitted.
- Create validates the required contact and line items and forces `DRAFT`.
  Update revalidates the payload, retains optional Xero line-item identifiers,
  and forces `DRAFT`.
- Delete delegates to the existing Xero boundary's documented `DELETED` status
  update. `DraftCommandService` checks the current record before update/delete,
  and the concrete status matrices prove all non-DRAFT values are rejected
  before mutation.
- The two legacy globally coupled quote handlers were deleted. Their legacy
  create/update tool wrappers and catalog entries were also removed because
  they statically imported those handlers. No generic preview/apply MCP tools
  or replacement quote tools were introduced.

## Full verification

Fresh pre-commit completion checks:

| Check | Result |
| --- | --- |
| `npm test -- src/xero/draft-adapters/quote.test.ts src/xero/draft-adapters/purchase-order.test.ts src/drafts/resource-registry.test.ts src/drafts/draft-command-service.test.ts` | Exit 0; 4 files, 27/27 tests passed. |
| `npm test` | Exit 0; 15 files, 117/117 tests passed. |
| `npm run typecheck` | Exit 0; no diagnostics. |
| `npm run lint` | Exit 0; no diagnostics. |
| `npm run build` | Exit 0; TypeScript build and executable-bit step completed. |
| `npx prettier --check` on all Task 6 source/test/index files | Exit 0; all files matched Prettier style. |
| `git diff --check` | Exit 0; no whitespace errors. |

## Commit

The Task 6 changes are committed with subject:

```text
feat: add confirmed quote and purchase order drafts
```

## Self-review

- Re-read the Task 6 brief and checked each interface requirement against the
  complete diff.
- Mutation review confirms tests fail for wrong SDK resource routing, missing
  or incorrect `DRAFT`, a dropped idempotency key, stripped `lineItemID`, an
  omitted registry entry, or any non-DRAFT status reaching update/delete.
- Import search found no remaining reference to the deleted quote handlers or
  legacy quote mutation tools.
- Scope search confirms no manual-journal, recurring-invoice, receipt, generic
  MCP-tool, or non-draft-transition implementation was added.
- No Critical or Important correctness, safety, or scope issue was found.

## Scope and remaining concerns

- Task 6 intentionally does not expose the generic MCP preview/apply tools;
  that later task owns the public mutation surface.
- Draft-state enforcement is owned by `DraftCommandService`; the registry is
  the intended path for resolving these adapters.
