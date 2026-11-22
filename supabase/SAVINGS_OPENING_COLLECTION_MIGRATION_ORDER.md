# Savings, Opening Data and Daily Collection — Migration Order

This document describes the intended dependency order for the unified Savings Ledger, Opening Data Input and Daily Collection modules.

## Important

- Do not run these migrations against the live Supabase project until the owner explicitly approves the database rollout.
- Do not create sample members, opening balances, loans or collection transactions during code review.
- The list below is an implementation order, not a statement that the live database has been updated.
- If a migration has already been applied in the target database, inspect its schema and data before rerunning or skipping it.

## Required order

1. `schema.sql`
2. `security.sql`
3. `assistant_admin.sql`
4. `member_registration.sql`
5. `samity_management.sql`
6. `optional_savings_versions.sql`
7. `holiday_calendar.sql`
8. `loan_collection.sql`
9. `collection_sheet.sql`
10. `opening_loan_balances.sql`
11. `opening_savings_balances.sql`
12. `daily_collection_posting.sql`
13. `member_savings_ledger.sql`
14. `optional_savings_opening_details.sql` (Opening Data Optional Savings fields)
15. `atomic_opening_loan_schedule_save` (Supabase migration history; function-based atomic save)
16. `versioned_opening_loan_schedules.sql` (history-preserving schedule revisions)

## Integration notes

- The unified Savings screen uses the `savings_transactions` ledger with `savings_category` values `GS`, `LTS-New` and `Optional`.
- The legacy `savings_type` and `enrollment_id` fields are retained for compatibility with existing mandatory/optional enrollment records.
- When the daily-collection migration adds `savings_category`, it backfills existing legacy rows: `optional` becomes `Optional`; other legacy rows become `GS`. Review existing records before any production migration.
- Daily collection writes into the same savings ledger. Optional Savings entries must reference the exact Optional enrollment.
- Opening Savings balances remain separate opening amounts and are included in member category balances.
- Opening loans remain separate from new loan accounts. Daily collection can post repayments against opening-loan balances.
- `member_savings_ledger.sql` applies the final read/insert policies, withdrawal-balance guard and audit trigger after the shared ledger columns and daily posting structures exist.

## Verification still required before live rollout

- Review the actual target Supabase schema and existing savings records.
- Confirm that every migration is compatible with the current live schema and existing RLS policies.
- Run migrations only after explicit approval, in a controlled maintenance window with a verified backup.
- Perform authorized end-to-end checks in a non-production environment first.
- Do not mark the module production-ready until Opening Data Input, Savings deposits/withdrawals, Daily Collection posting, correction controls, Day End and Month End have all passed those checks.


## Opening-loan schedule safety update

The connected Supabase project has received the Opening Data Optional Savings details migration and the atomic opening-loan save function. The follow-up versioning migration adds `schedule_version` and `is_current` to the opening-loan installment schedule. Existing rows are retained as history; schedule edits create a new version rather than deleting prior schedule rows. The daily-collection posting function and collection screen now use only the current schedule version. The SQL source for the versioned schedule migration is `versioned_opening_loan_schedules.sql`.

The application changes are on the feature branch only. The PR remains Draft; no Production merge or Production deployment has been performed. End-to-end testing with real operational records remains outstanding.
