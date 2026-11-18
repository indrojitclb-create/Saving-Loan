-- Collection sheet support: classify savings transactions as GS or LTS-New.
-- Run once in Supabase SQL Editor after loan_collection.sql.
alter table public.savings_transactions
  add column if not exists savings_category text not null default 'GS'
    check (savings_category in ('GS','LTS-New')),
  add column if not exists enrollment_id uuid references public.member_savings_enrollments(id) on delete set null;

create index if not exists savings_transactions_member_date_idx
  on public.savings_transactions(member_id, transaction_date);
create index if not exists loan_transactions_loan_date_idx
  on public.loan_transactions(loan_id, transaction_date);
