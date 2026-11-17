-- Assistant Admin role and permission-based user creation.
-- Run this in Supabase SQL Editor after the existing schema/security scripts.

alter type public.app_role add value if not exists 'assistant_admin';

create or replace function public.has_module_permission(p_module_key text, p_action text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case p_action
      when 'view' then pp.can_view
      when 'create' then pp.can_create
      when 'update' then pp.can_update
      when 'delete' then pp.can_delete
      else false
    end
    from public.profile_permissions pp
    join public.profiles p on p.id = pp.profile_id
    where pp.profile_id = (select auth.uid())
      and pp.module_key = p_module_key
      and p.is_active = true
    limit 1
  ), false)
$$;

-- Main Admin profile is visible only to the Main Admin account itself.
-- Co-admin, Assistant Admin, and all other users cannot read it.
drop policy if exists profiles_read_scope on public.profiles;
create policy profiles_read_scope on public.profiles
for select to authenticated
using (
  id = (select auth.uid())
  or public.current_app_role() = 'main_admin'
  or (
    role <> 'main_admin'
    and (
      public.current_app_role() = 'co_admin'
      or public.has_module_permission('users', 'view')
    )
  )
);

-- Only Main Admin and Co-admin may assign or change permissions.
drop policy if exists permissions_admin_manage on public.profile_permissions;
create policy permissions_admin_manage on public.profile_permissions
for all to authenticated
using (
  public.current_app_role() = 'main_admin'
  or (
    public.current_app_role() = 'co_admin'
    and exists (
      select 1 from public.profiles target
      where target.id = profile_permissions.profile_id
        and target.role <> 'main_admin'
    )
  )
)
with check (
  public.current_app_role() = 'main_admin'
  or (
    public.current_app_role() = 'co_admin'
    and exists (
      select 1 from public.profiles target
      where target.id = profile_permissions.profile_id
        and target.role <> 'main_admin'
    )
  )
);
