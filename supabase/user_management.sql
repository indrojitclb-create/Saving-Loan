-- Role protection: Co-admins may manage non-Main-Admin profiles only.
-- Only a Main Admin can create or promote a Main Admin.
drop policy if exists profiles_admin_manage on public.profiles;
create policy profiles_admin_manage on public.profiles
for all to authenticated
using (
  public.current_app_role() = 'main_admin'
  or (public.current_app_role() = 'co_admin' and role <> 'main_admin')
)
with check (
  public.current_app_role() = 'main_admin'
  or (public.current_app_role() = 'co_admin' and role <> 'main_admin')
);
