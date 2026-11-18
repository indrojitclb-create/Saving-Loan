-- Loan schedule and samity closure calendar.
-- Run this once in Supabase SQL Editor after the existing schema and samity scripts.

alter table public.loan_accounts
  alter column term_months drop not null,
  add column if not exists term_weeks integer not null default 46,
  add column if not exists service_charge_rate numeric(9,6) not null default 0.24,
  add column if not exists total_service_charge numeric(14,2),
  add column if not exists total_repayable numeric(14,2),
  add column if not exists first_installment_date date,
  add column if not exists schedule_status text not null default 'pending'
    check (schedule_status in ('pending','generated','completed'));

alter table public.loan_transactions
  add column if not exists schedule_id uuid;

create table if not exists public.samity_week_closures (
  id uuid primary key default gen_random_uuid(),
  samity_id uuid not null references public.samities(id) on delete restrict,
  closure_date date not null,
  reason text not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (samity_id, closure_date)
);

create table if not exists public.loan_installment_schedule (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loan_accounts(id) on delete restrict,
  week_no integer not null check (week_no between 1 and 46),
  due_date date not null,
  opening_principal numeric(14,6) not null,
  principal_due numeric(14,6) not null,
  service_charge_due numeric(14,6) not null,
  total_due numeric(14,6) not null,
  principal_paid numeric(14,6) not null default 0,
  service_charge_paid numeric(14,6) not null default 0,
  status text not null default 'due' check (status in ('due','partial','paid','overdue')),
  created_at timestamptz not null default now(),
  unique (loan_id, week_no),
  unique (loan_id, due_date)
);

alter table public.loan_transactions
  drop constraint if exists loan_transactions_schedule_id_fkey;
alter table public.loan_transactions
  add constraint loan_transactions_schedule_id_fkey
  foreign key (schedule_id) references public.loan_installment_schedule(id) on delete set null;

create index if not exists loan_schedule_due_date_idx
  on public.loan_installment_schedule(due_date, status);
create index if not exists loan_schedule_loan_week_idx
  on public.loan_installment_schedule(loan_id, week_no);
create index if not exists samity_closures_date_idx
  on public.samity_week_closures(samity_id, closure_date);

alter table public.samity_week_closures enable row level security;
alter table public.loan_installment_schedule enable row level security;

drop policy if exists samity_week_closures_read on public.samity_week_closures;
create policy samity_week_closures_read on public.samity_week_closures
for select to authenticated
using (
  exists (
    select 1 from public.samities s
    where s.id = samity_id and public.can_access_branch(s.branch_id)
  )
  and (
    public.can_manage_module('loans','view')
    or public.can_manage_module('loans','create')
    or public.can_manage_module('loans','update')
  )
);

drop policy if exists samity_week_closures_write on public.samity_week_closures;
create policy samity_week_closures_write on public.samity_week_closures
for insert to authenticated
with check (
  exists (
    select 1 from public.samities s
    where s.id = samity_id and public.can_access_branch(s.branch_id)
  )
  and public.can_manage_module('loans','create')
  and created_by = (select auth.uid())
);

drop policy if exists loan_schedule_read on public.loan_installment_schedule;
create policy loan_schedule_read on public.loan_installment_schedule
for select to authenticated
using (
  exists (
    select 1 from public.loan_accounts a
    where a.id = loan_id and public.can_access_member(a.member_id)
  )
  and (
    public.can_manage_module('loans','view')
    or public.can_manage_module('loans','create')
    or public.can_manage_module('loans','update')
  )
);

drop policy if exists loan_schedule_insert on public.loan_installment_schedule;
create policy loan_schedule_insert on public.loan_installment_schedule
for insert to authenticated
with check (
  exists (
    select 1 from public.loan_accounts a
    where a.id = loan_id and public.can_access_member(a.member_id)
  )
  and public.can_manage_module('loans','create')
);

drop policy if exists loan_schedule_update on public.loan_installment_schedule;
create policy loan_schedule_update on public.loan_installment_schedule
for update to authenticated
using (
  exists (
    select 1 from public.loan_accounts a
    where a.id = loan_id and public.can_access_member(a.member_id)
  )
  and public.can_manage_module('loans','update')
)
with check (
  exists (
    select 1 from public.loan_accounts a
    where a.id = loan_id and public.can_access_member(a.member_id)
  )
  and public.can_manage_module('loans','update')
);

-- Permit staff with explicit loan-create permission to register disbursements.
drop policy if exists loans_insert_scope on public.loan_accounts;
create policy loans_insert_scope on public.loan_accounts
for insert to authenticated
with check (
  public.can_access_member(member_id)
  and public.can_manage_module('loans','create')
  and created_by = (select auth.uid())
);

drop policy if exists loan_tx_insert_scope on public.loan_transactions;
create policy loan_tx_insert_scope on public.loan_transactions
for insert to authenticated
with check (
  created_by = (select auth.uid())
  and public.can_manage_module('loans','create')
  and exists (
    select 1 from public.loan_accounts la
    where la.id = loan_id and public.can_access_member(la.member_id)
  )
);
