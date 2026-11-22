-- Read-only access for the Reports module.
-- Apply after security.sql, assistant_admin.sql, opening_loan_balances.sql,
-- member_savings_ledger.sql and daily_collection_posting.sql.

drop policy if exists reports_read_members on public.members;
create policy reports_read_members on public.members
for select to authenticated
using (
  public.can_access_member(id)
  and public.has_module_permission('reports','view')
);

drop policy if exists reports_read_savings_transactions on public.savings_transactions;
create policy reports_read_savings_transactions on public.savings_transactions
for select to authenticated
using (
  public.can_access_member(member_id)
  and public.has_module_permission('reports','view')
);

drop policy if exists reports_read_loan_transactions on public.loan_transactions;
create policy reports_read_loan_transactions on public.loan_transactions
for select to authenticated
using (
  public.has_module_permission('reports','view')
  and exists (
    select 1 from public.loan_accounts a
    where a.id=loan_id and public.can_access_member(a.member_id)
  )
);

drop policy if exists reports_read_opening_loans on public.member_opening_loans;
create policy reports_read_opening_loans on public.member_opening_loans
for select to authenticated
using (
  public.can_access_member(member_id)
  and public.has_module_permission('reports','view')
);

drop policy if exists reports_read_opening_loan_transactions on public.member_opening_loan_transactions;
create policy reports_read_opening_loan_transactions on public.member_opening_loan_transactions
for select to authenticated
using (
  public.has_module_permission('reports','view')
  and exists (
    select 1 from public.member_opening_loans l
    where l.id=opening_loan_id and public.can_access_member(l.member_id)
  )
);
