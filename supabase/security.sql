-- Saving & Loan: first security migration
-- Run this after schema.sql in Supabase SQL Editor.
-- Financial transaction rows are append-only for normal users.

alter table public.profiles
  add column if not exists branch_id uuid references public.branches(id),
  add column if not exists employee_id uuid references public.employees(id),
  add column if not exists area_name text;

create or replace function public.current_app_role()
returns public.app_role
language sql stable security definer
set search_path = public
as $$
  select p.role from public.profiles p
  where p.id = (select auth.uid()) and p.is_active = true
  limit 1
$$;

create or replace function public.is_admin_or_coadmin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(public.current_app_role() in ('main_admin','co_admin'), false)
$$;

create or replace function public.can_access_branch(p_branch_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select case
    when public.is_admin_or_coadmin() then true
    when public.current_app_role() = 'branch_manager' then exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.is_active
        and p.branch_id = p_branch_id
    )
    when public.current_app_role() = 'area_manager' then exists (
      select 1
      from public.profiles p
      join public.branches b on b.area_name = p.area_name
      where p.id = (select auth.uid()) and p.is_active
        and b.id = p_branch_id
    )
    when public.current_app_role() = 'co' then exists (
      select 1 from public.profiles p
      join public.employees e on e.id = p.employee_id
      where p.id = (select auth.uid()) and p.is_active
        and e.branch_id = p_branch_id
    )
    else false
  end
$$;

create or replace function public.can_access_member(p_member_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.members m
    where m.id = p_member_id
      and (
        public.can_access_branch(m.branch_id)
        or (
          public.current_app_role() = 'co'
          and exists (
            select 1 from public.profiles p
            where p.id = (select auth.uid()) and p.is_active
              and p.employee_id = m.assigned_employee
          )
        )
      )
  )
$$;

-- Remove the starter self-read policy before installing the complete profile policy.
drop policy if exists profile_read_self on public.profiles;
drop policy if exists profiles_read_scope on public.profiles;
create policy profiles_read_scope on public.profiles
for select to authenticated
using (id = (select auth.uid()) or public.is_admin_or_coadmin());

drop policy if exists profiles_admin_manage on public.profiles;
create policy profiles_admin_manage on public.profiles
for all to authenticated
using (public.is_admin_or_coadmin())
with check (public.is_admin_or_coadmin());

drop policy if exists branches_read_scope on public.branches;
create policy branches_read_scope on public.branches
for select to authenticated
using (public.can_access_branch(id));

drop policy if exists branches_admin_manage on public.branches;
create policy branches_admin_manage on public.branches
for all to authenticated
using (public.is_admin_or_coadmin())
with check (public.is_admin_or_coadmin());

drop policy if exists employees_read_scope on public.employees;
create policy employees_read_scope on public.employees
for select to authenticated
using (public.can_access_branch(branch_id));

drop policy if exists employees_admin_manage on public.employees;
create policy employees_admin_manage on public.employees
for all to authenticated
using (public.is_admin_or_coadmin())
with check (public.is_admin_or_coadmin());

drop policy if exists permissions_read_scope on public.profile_permissions;
create policy permissions_read_scope on public.profile_permissions
for select to authenticated
using (profile_id = (select auth.uid()) or public.is_admin_or_coadmin());

drop policy if exists permissions_admin_manage on public.profile_permissions;
create policy permissions_admin_manage on public.profile_permissions
for all to authenticated
using (public.is_admin_or_coadmin())
with check (public.is_admin_or_coadmin());

drop policy if exists members_read_scope on public.members;
create policy members_read_scope on public.members
for select to authenticated
using (public.can_access_branch(branch_id) or (
  public.current_app_role() = 'co' and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_active
      and p.employee_id = assigned_employee
  )
));

drop policy if exists members_insert_scope on public.members;
create policy members_insert_scope on public.members
for insert to authenticated
with check (
  public.can_access_branch(branch_id)
  and created_by = (select auth.uid())
);

drop policy if exists members_update_admin on public.members;
create policy members_update_admin on public.members
for update to authenticated
using (public.is_admin_or_coadmin())
with check (public.is_admin_or_coadmin());

drop policy if exists members_delete_admin on public.members;
create policy members_delete_admin on public.members
for delete to authenticated
using (public.is_admin_or_coadmin());

drop policy if exists savings_read_scope on public.savings_transactions;
create policy savings_read_scope on public.savings_transactions
for select to authenticated
using (public.can_access_member(member_id));

drop policy if exists savings_insert_scope on public.savings_transactions;
create policy savings_insert_scope on public.savings_transactions
for insert to authenticated
with check (
  public.can_access_member(member_id)
  and created_by = (select auth.uid())
);

drop policy if exists loans_read_scope on public.loan_accounts;
create policy loans_read_scope on public.loan_accounts
for select to authenticated
using (public.can_access_member(member_id));

drop policy if exists loans_insert_scope on public.loan_accounts;
create policy loans_insert_scope on public.loan_accounts
for insert to authenticated
with check (
  public.is_admin_or_coadmin()
  and created_by = (select auth.uid())
);

drop policy if exists loans_update_admin on public.loan_accounts;
create policy loans_update_admin on public.loan_accounts
for update to authenticated
using (public.is_admin_or_coadmin())
with check (public.is_admin_or_coadmin());

drop policy if exists loan_tx_read_scope on public.loan_transactions;
create policy loan_tx_read_scope on public.loan_transactions
for select to authenticated
using (exists (
  select 1 from public.loan_accounts la
  where la.id = loan_id and public.can_access_member(la.member_id)
));

drop policy if exists loan_tx_insert_scope on public.loan_transactions;
create policy loan_tx_insert_scope on public.loan_transactions
for insert to authenticated
with check (
  created_by = (select auth.uid())
  and exists (
    select 1 from public.loan_accounts la
    where la.id = loan_id and public.can_access_member(la.member_id)
  )
);

drop policy if exists audit_read_admin on public.audit_logs;
create policy audit_read_admin on public.audit_logs
for select to authenticated
using (public.is_admin_or_coadmin());

drop policy if exists audit_insert_self on public.audit_logs;
create policy audit_insert_self on public.audit_logs
for insert to authenticated
with check (actor_id = (select auth.uid()));

-- No update/delete policies are created for financial transactions or audit logs.
