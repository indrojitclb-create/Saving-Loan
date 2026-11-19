-- Central holiday calendar for organization, branch and samity scopes.
-- Run once in Supabase SQL Editor after schema.sql, security.sql, samity_management.sql, and loan_collection.sql.

create table if not exists public.holiday_calendar_settings (
  id integer primary key default 1 check (id = 1),
  friday_holiday_enabled boolean not null default true,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
insert into public.holiday_calendar_settings (id, friday_holiday_enabled)
values (1, true) on conflict (id) do nothing;

create table if not exists public.holiday_calendar (
  id uuid primary key default gen_random_uuid(),
  date_from date not null,
  date_to date not null,
  holiday_type text not null default 'Public',
  scope text not null check (scope in ('organization','branch','samity')),
  branch_id uuid references public.branches(id) on delete restrict,
  samity_id uuid references public.samities(id) on delete restrict,
  description text,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint holiday_calendar_date_range check (date_to >= date_from),
  constraint holiday_calendar_scope_target check (
    (scope = 'organization' and branch_id is null and samity_id is null) or
    (scope = 'branch' and branch_id is not null and samity_id is null) or
    (scope = 'samity' and samity_id is not null and branch_id is null)
  )
);
create index if not exists holiday_calendar_dates_idx
  on public.holiday_calendar (date_from, date_to) where is_active;
create index if not exists holiday_calendar_branch_idx
  on public.holiday_calendar (branch_id, date_from, date_to) where is_active;
create index if not exists holiday_calendar_samity_idx
  on public.holiday_calendar (samity_id, date_from, date_to) where is_active;

alter table public.holiday_calendar enable row level security;
alter table public.holiday_calendar_settings enable row level security;

drop policy if exists holiday_calendar_read on public.holiday_calendar;
create policy holiday_calendar_read on public.holiday_calendar
for select to authenticated using (
  (
    public.can_manage_module('holiday_calendar','view')
    or public.can_manage_module('collection','view')
    or public.can_manage_module('collection','create')
    or public.can_manage_module('loans','view')
    or public.can_manage_module('loans','create')
    or public.can_manage_module('loans','update')
  )
  and (
    scope = 'organization'
    or (scope = 'branch' and public.can_access_branch(branch_id))
    or (scope = 'samity' and exists (
      select 1 from public.samities s where s.id = samity_id and public.can_access_branch(s.branch_id)
    ))
  )
);
drop policy if exists holiday_calendar_insert on public.holiday_calendar;
create policy holiday_calendar_insert on public.holiday_calendar
for insert to authenticated with check (
  public.can_manage_module('holiday_calendar','create')
  and created_by = (select auth.uid())
  and (
    scope = 'organization'
    or (scope = 'branch' and public.can_access_branch(branch_id))
    or (scope = 'samity' and exists (
      select 1 from public.samities s where s.id = samity_id and public.can_access_branch(s.branch_id)
    ))
  )
);
drop policy if exists holiday_calendar_update on public.holiday_calendar;
create policy holiday_calendar_update on public.holiday_calendar
for update to authenticated
using (
  public.can_manage_module('holiday_calendar','update')
  and (
    scope = 'organization'
    or (scope = 'branch' and public.can_access_branch(branch_id))
    or (scope = 'samity' and exists (
      select 1 from public.samities s where s.id = samity_id and public.can_access_branch(s.branch_id)
    ))
  )
)
with check (
  public.can_manage_module('holiday_calendar','update')
  and (
    scope = 'organization'
    or (scope = 'branch' and public.can_access_branch(branch_id))
    or (scope = 'samity' and exists (
      select 1 from public.samities s where s.id = samity_id and public.can_access_branch(s.branch_id)
    ))
  )
);
drop policy if exists holiday_calendar_delete on public.holiday_calendar;
create policy holiday_calendar_delete on public.holiday_calendar
for delete to authenticated using (public.can_manage_module('holiday_calendar','delete'));

drop policy if exists holiday_calendar_settings_read on public.holiday_calendar_settings;
create policy holiday_calendar_settings_read on public.holiday_calendar_settings
for select to authenticated using (true);
drop policy if exists holiday_calendar_settings_insert on public.holiday_calendar_settings;
create policy holiday_calendar_settings_insert on public.holiday_calendar_settings
for insert to authenticated with check (
  public.can_manage_module('holiday_calendar','update')
);
drop policy if exists holiday_calendar_settings_update on public.holiday_calendar_settings;
create policy holiday_calendar_settings_update on public.holiday_calendar_settings
for update to authenticated using (
  public.can_manage_module('holiday_calendar','update')
) with check (
  public.can_manage_module('holiday_calendar','update')
);

create or replace function public.is_holiday_for_samity(p_samity_id uuid, p_date date)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select
    coalesce((select friday_holiday_enabled from public.holiday_calendar_settings where id = 1), true)
      and extract(dow from p_date) = 5
    or exists (
      select 1
      from public.holiday_calendar h
      join public.samities s on s.id = p_samity_id
      where h.is_active
        and p_date between h.date_from and h.date_to
        and (
          h.scope = 'organization'
          or (h.scope = 'branch' and h.branch_id = s.branch_id)
          or (h.scope = 'samity' and h.samity_id = s.id)
        )
    )
    or exists (
      select 1 from public.samity_week_closures c
      where c.samity_id = p_samity_id and c.closure_date = p_date
    );
$$;

create or replace function public.prevent_holiday_transaction()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_samity_id uuid;
  v_date date;
begin
  v_date := (to_jsonb(new)->>'transaction_date')::date;
  if tg_table_name = 'loan_accounts' then
    select samity_id into v_samity_id from public.members where id = new.member_id;
    v_date := new.disbursement_date;
  elsif tg_table_name = 'loan_installment_schedule' then
    select m.samity_id into v_samity_id
    from public.loan_accounts a join public.members m on m.id = a.member_id
    where a.id = new.loan_id;
    v_date := new.due_date;
  elsif tg_table_name = 'loan_transactions' then
    select m.samity_id into v_samity_id
    from public.loan_accounts a join public.members m on m.id = a.member_id
    where a.id = new.loan_id;
  elsif tg_table_name = 'savings_transactions' then
    select samity_id into v_samity_id from public.members where id = new.member_id;
  end if;

  if v_samity_id is not null and v_date is not null
     and public.is_holiday_for_samity(v_samity_id, v_date) then
    raise exception 'HOLIDAY_BLOCK: এই তারিখে প্রতিষ্ঠান/শাখা/সমিতি বন্ধ। অন্য তারিখ নির্বাচন করুন।';
  end if;
  return new;
end;
$$;

drop trigger if exists savings_transactions_holiday_guard on public.savings_transactions;
create trigger savings_transactions_holiday_guard
before insert or update of transaction_date, member_id on public.savings_transactions
for each row execute function public.prevent_holiday_transaction();

drop trigger if exists loan_transactions_holiday_guard on public.loan_transactions;
create trigger loan_transactions_holiday_guard
before insert or update of transaction_date, loan_id on public.loan_transactions
for each row execute function public.prevent_holiday_transaction();

drop trigger if exists loan_accounts_holiday_guard on public.loan_accounts;
create trigger loan_accounts_holiday_guard
before insert or update of disbursement_date, member_id on public.loan_accounts
for each row execute function public.prevent_holiday_transaction();

drop trigger if exists loan_schedule_holiday_guard on public.loan_installment_schedule;
create trigger loan_schedule_holiday_guard
before insert or update of due_date, loan_id on public.loan_installment_schedule
for each row execute function public.prevent_holiday_transaction();

grant select, insert, update, delete on public.holiday_calendar to authenticated;
grant select, insert, update on public.holiday_calendar_settings to authenticated;
