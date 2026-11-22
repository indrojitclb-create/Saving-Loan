-- Opening Loan Data Input
-- Keeps pre-existing loans separate from loans disbursed after system go-live.
-- Apply after schema.sql, security.sql, assistant_admin.sql and loan_collection.sql.

create table if not exists public.member_opening_loans (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete restrict,
  loan_no text not null,
  disbursement_date date not null,
  project_name text not null,
  loan_cycle integer not null check (loan_cycle > 0),
  principal_amount numeric(14,2) not null check (principal_amount > 0),
  service_charge_amount numeric(14,2) not null default 0 check (service_charge_amount >= 0),
  amount_repaid_to_date numeric(14,2) not null default 0 check (amount_repaid_to_date >= 0),
  current_status text not null default 'active'
    check (current_status in ('active','closed','written_off')),
  overdue_balance numeric(14,2) not null default 0 check (overdue_balance >= 0),
  outstanding_balance numeric(14,2)
    generated always as (greatest(principal_amount + service_charge_amount - amount_repaid_to_date, 0::numeric)) stored,
  last_installment_no integer not null default 0 check (last_installment_no >= 0),
  reference_no text,
  notes text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  unique (member_id, loan_no),
  check (amount_repaid_to_date <= principal_amount + service_charge_amount)
);

create index if not exists member_opening_loans_member_idx
  on public.member_opening_loans(member_id);
create index if not exists member_opening_loans_status_idx
  on public.member_opening_loans(current_status);

alter table public.member_opening_loans enable row level security;

drop policy if exists opening_loans_read_scope on public.member_opening_loans;
create policy opening_loans_read_scope on public.member_opening_loans
for select to authenticated
using (
  public.can_access_member(member_id)
  and (
    public.is_admin_or_coadmin()
    or public.has_module_permission('opening_data','view')
    or public.has_module_permission('opening_data','create')
    or public.has_module_permission('opening_data','update')
  )
);

drop policy if exists opening_loans_insert_scope on public.member_opening_loans;
create policy opening_loans_insert_scope on public.member_opening_loans
for insert to authenticated
with check (
  public.can_access_member(member_id)
  and (public.is_admin_or_coadmin() or public.has_module_permission('opening_data','create'))
  and created_by = (select auth.uid())
);

drop policy if exists opening_loans_update_scope on public.member_opening_loans;
create policy opening_loans_update_scope on public.member_opening_loans
for update to authenticated
using (
  public.can_access_member(member_id)
  and (public.is_admin_or_coadmin() or public.has_module_permission('opening_data','update'))
)
with check (
  public.can_access_member(member_id)
  and (public.is_admin_or_coadmin() or public.has_module_permission('opening_data','update'))
  and updated_by = (select auth.uid())
);

create or replace function public.audit_member_opening_loan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs(actor_id, action, table_name, record_id, details)
  values (
    coalesce(new.updated_by, new.created_by, auth.uid()),
    case when tg_op = 'INSERT' then 'opening_loan_created' else 'opening_loan_updated' end,
    'member_opening_loans',
    new.id::text,
    jsonb_build_object(
      'member_id', new.member_id,
      'loan_no', new.loan_no,
      'disbursement_date', new.disbursement_date,
      'project_name', new.project_name,
      'loan_cycle', new.loan_cycle,
      'principal_amount', new.principal_amount,
      'service_charge_amount', new.service_charge_amount,
      'amount_repaid_to_date', new.amount_repaid_to_date,
      'outstanding_balance', new.outstanding_balance,
      'current_status', new.current_status,
      'overdue_balance', new.overdue_balance,
      'last_installment_no', new.last_installment_no
    )
  );
  return new;
end;
$$;

drop trigger if exists member_opening_loan_audit on public.member_opening_loans;
create trigger member_opening_loan_audit
after insert or update on public.member_opening_loans
for each row execute function public.audit_member_opening_loan();

-- Opening loan users need scoped member identities for the form.
drop policy if exists members_read_opening_loan_scope on public.members;
create policy members_read_opening_loan_scope on public.members
for select to authenticated
using (
  public.can_access_member(id)
  and (
    public.has_module_permission('opening_data','view')
    or public.has_module_permission('opening_data','create')
    or public.has_module_permission('opening_data','update')
  )
);


-- Repayment schedule continuation for opening loans.
alter table public.member_opening_loans
  add column if not exists last_installment_date date,
  add column if not exists next_installment_date date,
  add column if not exists next_collectible_balance numeric(14,2) not null default 0;

create table if not exists public.member_opening_loan_installment_schedule (
  id uuid primary key default gen_random_uuid(),
  opening_loan_id uuid not null references public.member_opening_loans(id) on delete cascade,
  installment_no integer not null check (installment_no between 1 and 46),
  due_date date not null,
  principal_due numeric(14,2) not null default 0 check (principal_due >= 0),
  service_charge_due numeric(14,2) not null default 0 check (service_charge_due >= 0),
  total_due numeric(14,2) not null check (total_due >= 0),
  status text not null default 'due' check (status in ('due','partial','paid','overdue')),
  created_at timestamptz not null default now(),
  unique(opening_loan_id, installment_no),
  unique(opening_loan_id, due_date)
);
create index if not exists opening_loan_schedule_due_idx
  on public.member_opening_loan_installment_schedule(due_date,status);
alter table public.member_opening_loan_installment_schedule enable row level security;

drop policy if exists opening_loan_schedule_read on public.member_opening_loan_installment_schedule;
create policy opening_loan_schedule_read on public.member_opening_loan_installment_schedule
for select to authenticated using (
  exists(select 1 from public.member_opening_loans l
    where l.id=opening_loan_id and public.can_access_member(l.member_id))
  and (public.is_admin_or_coadmin()
    or public.has_module_permission('opening_data','view')
    or public.has_module_permission('opening_data','create')
    or public.has_module_permission('opening_data','update'))
);
drop policy if exists opening_loan_schedule_insert on public.member_opening_loan_installment_schedule;
create policy opening_loan_schedule_insert on public.member_opening_loan_installment_schedule
for insert to authenticated with check (
  exists(select 1 from public.member_opening_loans l
    where l.id=opening_loan_id and public.can_access_member(l.member_id))
  and (public.is_admin_or_coadmin() or public.has_module_permission('opening_data','create'))
);
drop policy if exists opening_loan_schedule_delete on public.member_opening_loan_installment_schedule;
create policy opening_loan_schedule_delete on public.member_opening_loan_installment_schedule
for delete to authenticated using (
  exists(select 1 from public.member_opening_loans l
    where l.id=opening_loan_id and public.can_access_member(l.member_id))
  and (public.is_admin_or_coadmin() or public.has_module_permission('opening_data','update'))
);

