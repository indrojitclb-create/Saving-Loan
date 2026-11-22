-- Opening Savings Balance (Opening Data Input)
-- Initial balances remain separate from the regular transaction ledger.
-- Apply after schema.sql, security.sql, assistant_admin.sql,
-- member_registration.sql and optional_savings_versions.sql.
create table if not exists public.member_savings_opening_balances (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete restrict,
  opening_date date not null default current_date,
  gs_balance numeric(14,2) not null default 0 check (gs_balance >= 0),
  lts_new_balance numeric(14,2) not null default 0 check (lts_new_balance >= 0),
  optional_balance numeric(14,2) not null default 0 check (optional_balance >= 0),
  reference_no text,
  notes text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  unique(member_id)
);
create index if not exists member_savings_opening_member_idx on public.member_savings_opening_balances(member_id);
alter table public.member_savings_opening_balances enable row level security;
drop policy if exists member_savings_opening_read on public.member_savings_opening_balances;
create policy member_savings_opening_read on public.member_savings_opening_balances for select to authenticated
using (public.can_access_member(member_id) and (public.is_admin_or_coadmin() or public.has_module_permission('opening_data','view') or public.has_module_permission('opening_data','create') or public.has_module_permission('savings','view') or public.has_module_permission('savings','create')));
drop policy if exists member_savings_opening_insert on public.member_savings_opening_balances;
create policy member_savings_opening_insert on public.member_savings_opening_balances for insert to authenticated
with check (public.can_access_member(member_id) and (public.is_admin_or_coadmin() or public.has_module_permission('opening_data','create')) and created_by=(select auth.uid()));
drop policy if exists member_savings_opening_update on public.member_savings_opening_balances;
create policy member_savings_opening_update on public.member_savings_opening_balances for update to authenticated
using (public.can_access_member(member_id) and (public.is_admin_or_coadmin() or public.has_module_permission('opening_data','update')))
with check (public.can_access_member(member_id) and (public.is_admin_or_coadmin() or public.has_module_permission('opening_data','update')));
create or replace function public.audit_member_savings_opening_balance()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.audit_logs(actor_id,action,table_name,record_id,details)
 values(coalesce(new.updated_by,new.created_by,auth.uid()),case when tg_op='INSERT' then 'opening_balance_created' else 'opening_balance_updated' end,
 'member_savings_opening_balances',new.id::text,
 jsonb_build_object('member_id',new.member_id,'gs_balance',new.gs_balance,'lts_new_balance',new.lts_new_balance,'optional_balance',new.optional_balance,'opening_date',new.opening_date));
 return new;
end $$;
drop trigger if exists member_savings_opening_balance_audit on public.member_savings_opening_balances;
create trigger member_savings_opening_balance_audit after insert or update on public.member_savings_opening_balances
for each row execute function public.audit_member_savings_opening_balance();

-- Opening Data Input users may read scoped member identity and optional enrollment data.
drop policy if exists members_read_opening_data on public.members;
create policy members_read_opening_data on public.members for select to authenticated
using (public.can_access_member(id) and (public.has_module_permission('opening_data','view') or public.has_module_permission('opening_data','create') or public.has_module_permission('opening_data','update')));
drop policy if exists member_savings_read_opening_data on public.member_savings_enrollments;
create policy member_savings_read_opening_data on public.member_savings_enrollments for select to authenticated
using (public.can_access_member(member_id) and (public.has_module_permission('opening_data','view') or public.has_module_permission('opening_data','create') or public.has_module_permission('opening_data','update')));
