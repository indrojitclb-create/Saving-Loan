-- Samity Formation & Central Work Area module
-- Run after schema.sql, security.sql, and assistant_admin.sql.
-- Safe to re-run: tables, columns, indexes and policies are guarded.

create or replace function public.can_manage_module(p_module_key text, p_action text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    public.current_app_role() in ('main_admin','co_admin')
    or public.has_module_permission(p_module_key, p_action),
    false
  )
$$;

-- Central geographic master data (hierarchical, standardized).
create table if not exists public.area_divisions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.area_districts (
  id uuid primary key default gen_random_uuid(),
  division_id uuid not null references public.area_divisions(id) on delete restrict,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (division_id, name)
);
create table if not exists public.area_upazilas (
  id uuid primary key default gen_random_uuid(),
  district_id uuid not null references public.area_districts(id) on delete restrict,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (district_id, name)
);
create table if not exists public.area_post_offices (
  id uuid primary key default gen_random_uuid(),
  upazila_id uuid not null references public.area_upazilas(id) on delete restrict,
  name text not null,
  post_code text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (upazila_id, name, post_code)
);
create table if not exists public.area_villages (
  id uuid primary key default gen_random_uuid(),
  post_office_id uuid not null references public.area_post_offices(id) on delete restrict,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (post_office_id, name)
);

-- Samity registration and its current weekly meeting schedule.
create table if not exists public.samities (
  id uuid primary key default gen_random_uuid(),
  samity_code text not null unique,
  samity_name text not null,
  village_id uuid not null references public.area_villages(id) on delete restrict,
  meeting_place text not null,
  meeting_day smallint not null check (meeting_day between 0 and 6),
  meeting_time time not null,
  start_date date,
  status text not null default 'active' check (status in ('active','inactive','closed')),
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists samities_village_idx on public.samities(village_id);
create index if not exists samities_status_idx on public.samities(status);

-- Each samity's current staff assignments.
create table if not exists public.samity_employee_assignments (
  id uuid primary key default gen_random_uuid(),
  samity_id uuid not null references public.samities(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  assigned_from date not null default current_date,
  assigned_to date,
  is_active boolean not null default true,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (assigned_to is null or assigned_to >= assigned_from)
);
create unique index if not exists samity_employee_one_active_assignment
  on public.samity_employee_assignments(samity_id, employee_id) where is_active = true;
create index if not exists samity_employee_employee_idx on public.samity_employee_assignments(employee_id);

-- Explicit change histories. Old and new values remain traceable.
create table if not exists public.samity_meeting_changes (
  id uuid primary key default gen_random_uuid(),
  samity_id uuid not null references public.samities(id) on delete restrict,
  old_day smallint not null check (old_day between 0 and 6),
  new_day smallint not null check (new_day between 0 and 6),
  old_time time not null,
  new_time time not null,
  old_place text not null,
  new_place text not null,
  effective_date date not null default current_date,
  reason text,
  changed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.samity_area_changes (
  id uuid primary key default gen_random_uuid(),
  samity_id uuid not null references public.samities(id) on delete restrict,
  old_village_id uuid not null references public.area_villages(id) on delete restrict,
  new_village_id uuid not null references public.area_villages(id) on delete restrict,
  effective_date date not null default current_date,
  reason text,
  changed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.employee_work_area_transfers (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete restrict,
  old_branch_id uuid references public.branches(id) on delete restrict,
  new_branch_id uuid references public.branches(id) on delete restrict,
  effective_date date not null default current_date,
  reason text,
  changed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.samity_employee_changes (
  id uuid primary key default gen_random_uuid(),
  samity_id uuid not null references public.samities(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  change_type text not null check (change_type in ('assigned','removed','replaced')),
  effective_date date not null default current_date,
  reason text,
  changed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Keep each member's current samity and preserve every transfer.
alter table public.members
  add column if not exists samity_id uuid references public.samities(id) on delete restrict;
create index if not exists members_samity_idx on public.members(samity_id);
create table if not exists public.member_samity_transfers (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete restrict,
  old_samity_id uuid references public.samities(id) on delete restrict,
  new_samity_id uuid not null references public.samities(id) on delete restrict,
  effective_date date not null default current_date,
  reason text,
  changed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists member_samity_transfer_member_idx on public.member_samity_transfers(member_id);

-- Updated timestamp maintained by database.
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end
$$;
drop trigger if exists samities_set_updated_at on public.samities;
create trigger samities_set_updated_at before update on public.samities
for each row execute function public.set_updated_at();

-- RLS: all signed-in staff may read standardized geography; writes are permission-controlled.
do $$
declare t text;
begin
  foreach t in array array[
    'area_divisions','area_districts','area_upazilas','area_post_offices','area_villages',
    'samities','samity_employee_assignments','samity_meeting_changes','samity_area_changes',
    'employee_work_area_transfers','samity_employee_changes','member_samity_transfers'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Area master data policies.
drop policy if exists area_divisions_read on public.area_divisions;
create policy area_divisions_read on public.area_divisions for select to authenticated using (true);
drop policy if exists area_divisions_manage on public.area_divisions;
create policy area_divisions_manage on public.area_divisions for all to authenticated
using (public.can_manage_module('area_master','update') or public.can_manage_module('area_master','create'))
with check (public.can_manage_module('area_master','create') or public.can_manage_module('area_master','update'));

drop policy if exists area_districts_read on public.area_districts;
create policy area_districts_read on public.area_districts for select to authenticated using (true);
drop policy if exists area_districts_manage on public.area_districts;
create policy area_districts_manage on public.area_districts for all to authenticated
using (public.can_manage_module('area_master','update') or public.can_manage_module('area_master','create'))
with check (public.can_manage_module('area_master','create') or public.can_manage_module('area_master','update'));

drop policy if exists area_upazilas_read on public.area_upazilas;
create policy area_upazilas_read on public.area_upazilas for select to authenticated using (true);
drop policy if exists area_upazilas_manage on public.area_upazilas;
create policy area_upazilas_manage on public.area_upazilas for all to authenticated
using (public.can_manage_module('area_master','update') or public.can_manage_module('area_master','create'))
with check (public.can_manage_module('area_master','create') or public.can_manage_module('area_master','update'));

drop policy if exists area_post_offices_read on public.area_post_offices;
create policy area_post_offices_read on public.area_post_offices for select to authenticated using (true);
drop policy if exists area_post_offices_manage on public.area_post_offices;
create policy area_post_offices_manage on public.area_post_offices for all to authenticated
using (public.can_manage_module('area_master','update') or public.can_manage_module('area_master','create'))
with check (public.can_manage_module('area_master','create') or public.can_manage_module('area_master','update'));

drop policy if exists area_villages_read on public.area_villages;
create policy area_villages_read on public.area_villages for select to authenticated using (true);
drop policy if exists area_villages_manage on public.area_villages;
create policy area_villages_manage on public.area_villages for all to authenticated
using (public.can_manage_module('area_master','update') or public.can_manage_module('area_master','create'))
with check (public.can_manage_module('area_master','create') or public.can_manage_module('area_master','update'));

-- Samity and operational history policies.
drop policy if exists samities_read on public.samities;
create policy samities_read on public.samities for select to authenticated
using (public.can_manage_module('samity','view') or public.can_manage_module('samity','create') or public.can_manage_module('samity','update'));
drop policy if exists samities_manage on public.samities;
create policy samities_manage on public.samities for all to authenticated
using (public.can_manage_module('samity','update') or public.can_manage_module('samity','create'))
with check (public.can_manage_module('samity','create') or public.can_manage_module('samity','update'));

drop policy if exists samity_employee_assignments_read on public.samity_employee_assignments;
create policy samity_employee_assignments_read on public.samity_employee_assignments for select to authenticated
using (public.can_manage_module('samity_staff','view') or public.can_manage_module('samity_staff','create') or public.can_manage_module('samity_staff','update'));
drop policy if exists samity_employee_assignments_manage on public.samity_employee_assignments;
create policy samity_employee_assignments_manage on public.samity_employee_assignments for all to authenticated
using (public.can_manage_module('samity_staff','update') or public.can_manage_module('samity_staff','create'))
with check (public.can_manage_module('samity_staff','create') or public.can_manage_module('samity_staff','update'));

drop policy if exists samity_meeting_changes_read on public.samity_meeting_changes;
create policy samity_meeting_changes_read on public.samity_meeting_changes for select to authenticated
using (public.can_manage_module('samity_day_change','view') or public.can_manage_module('samity_day_change','create'));
drop policy if exists samity_meeting_changes_insert on public.samity_meeting_changes;
create policy samity_meeting_changes_insert on public.samity_meeting_changes for insert to authenticated
with check (public.can_manage_module('samity_day_change','create') and changed_by = (select auth.uid()));

drop policy if exists samity_area_changes_read on public.samity_area_changes;
create policy samity_area_changes_read on public.samity_area_changes for select to authenticated
using (public.can_manage_module('samity_area_change','view') or public.can_manage_module('samity_area_change','create'));
drop policy if exists samity_area_changes_insert on public.samity_area_changes;
create policy samity_area_changes_insert on public.samity_area_changes for insert to authenticated
with check (public.can_manage_module('samity_area_change','create') and changed_by = (select auth.uid()));

drop policy if exists employee_work_area_transfers_read on public.employee_work_area_transfers;
create policy employee_work_area_transfers_read on public.employee_work_area_transfers for select to authenticated
using (public.can_manage_module('employee_transfer','view') or public.can_manage_module('employee_transfer','create'));
drop policy if exists employee_work_area_transfers_insert on public.employee_work_area_transfers;
create policy employee_work_area_transfers_insert on public.employee_work_area_transfers for insert to authenticated
with check (public.can_manage_module('employee_transfer','create') and changed_by = (select auth.uid()));

drop policy if exists samity_employee_changes_read on public.samity_employee_changes;
create policy samity_employee_changes_read on public.samity_employee_changes for select to authenticated
using (public.can_manage_module('samity_staff','view') or public.can_manage_module('samity_staff','create'));
drop policy if exists samity_employee_changes_insert on public.samity_employee_changes;
create policy samity_employee_changes_insert on public.samity_employee_changes for insert to authenticated
with check (public.can_manage_module('samity_staff','create') and changed_by = (select auth.uid()));

drop policy if exists member_samity_transfers_read on public.member_samity_transfers;
create policy member_samity_transfers_read on public.member_samity_transfers for select to authenticated
using (public.can_manage_module('member_transfer','view') or public.can_manage_module('member_transfer','create'));
drop policy if exists member_samity_transfers_insert on public.member_samity_transfers;
create policy member_samity_transfers_insert on public.member_samity_transfers for insert to authenticated
with check (public.can_manage_module('member_transfer','create') and changed_by = (select auth.uid()));

-- Existing permission editor will show these as separate permission modules after its UI is updated.


-- Atomic meeting schedule change: preserve history and update current schedule together.
create or replace function public.change_samity_meeting(
  p_samity_id uuid,
  p_new_day smallint,
  p_new_time time,
  p_new_place text,
  p_effective_date date,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.samities%rowtype;
begin
  if auth.uid() is null or not public.can_manage_module('samity_day_change','create') then
    raise exception 'Permission denied';
  end if;
  if p_new_day not between 0 and 6 or nullif(trim(p_new_place),'') is null or nullif(trim(p_reason),'') is null then
    raise exception 'নতুন দিন, সভাস্থল ও পরিবর্তনের কারণ দিতে হবে';
  end if;
  select * into v_old from public.samities where id = p_samity_id for update;
  if not found then raise exception 'Samity not found'; end if;

  insert into public.samity_meeting_changes (
    samity_id, old_day, new_day, old_time, new_time, old_place, new_place,
    effective_date, reason, changed_by
  ) values (
    v_old.id, v_old.meeting_day, p_new_day, v_old.meeting_time, p_new_time,
    v_old.meeting_place, trim(p_new_place), coalesce(p_effective_date,current_date),
    trim(p_reason), auth.uid()
  );

  update public.samities
  set meeting_day = p_new_day, meeting_time = p_new_time, meeting_place = trim(p_new_place)
  where id = p_samity_id;
end;
$$;
grant execute on function public.change_samity_meeting(uuid,smallint,time,text,date,text) to authenticated;

drop policy if exists samities_read on public.samities;
create policy samities_read on public.samities for select to authenticated
using (
  public.can_manage_module('samity','view')
  or public.can_manage_module('samity','create')
  or public.can_manage_module('samity','update')
  or public.can_manage_module('samity_day_change','view')
  or public.can_manage_module('samity_day_change','create')
);


-- Samity gender/type: male or female groups.
alter table public.samities
  add column if not exists samity_gender text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'samities_gender_check'
      and conrelid = 'public.samities'::regclass
  ) then
    alter table public.samities
      add constraint samities_gender_check
      check (samity_gender is null or samity_gender in ('male','female'));
  end if;
end $$;


-- Atomic samity work-area change: record old/new village and update current village together.
create or replace function public.change_samity_area(
  p_samity_id uuid,
  p_new_village_id uuid,
  p_effective_date date,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_village uuid;
begin
  if auth.uid() is null or not public.can_manage_module('samity_area_change','create') then
    raise exception 'Permission denied';
  end if;
  if p_new_village_id is null or nullif(trim(p_reason),'') is null then
    raise exception 'নতুন গ্রাম ও পরিবর্তনের কারণ দিতে হবে';
  end if;
  perform 1 from public.area_villages where id = p_new_village_id and is_active = true;
  if not found then raise exception 'নির্বাচিত নতুন গ্রামটি সক্রিয় নয় বা পাওয়া যায়নি'; end if;

  select village_id into v_old_village
  from public.samities where id = p_samity_id for update;
  if not found then raise exception 'Samity not found'; end if;
  if v_old_village = p_new_village_id then
    raise exception 'নতুন এলাকা বর্তমান এলাকার একই';
  end if;

  insert into public.samity_area_changes (
    samity_id, old_village_id, new_village_id, effective_date, reason, changed_by
  ) values (
    p_samity_id, v_old_village, p_new_village_id,
    coalesce(p_effective_date,current_date), trim(p_reason), auth.uid()
  );

  update public.samities set village_id = p_new_village_id where id = p_samity_id;
end;
$$;
grant execute on function public.change_samity_area(uuid,uuid,date,text) to authenticated;

drop policy if exists samities_read on public.samities;
create policy samities_read on public.samities for select to authenticated
using (
  public.can_manage_module('samity','view')
  or public.can_manage_module('samity','create')
  or public.can_manage_module('samity','update')
  or public.can_manage_module('samity_day_change','view')
  or public.can_manage_module('samity_day_change','create')
  or public.can_manage_module('samity_area_change','view')
  or public.can_manage_module('samity_area_change','create')
);


-- Samity branch transfer: keep the current branch on samities and preserve every change.
alter table public.samities
  add column if not exists branch_id uuid references public.branches(id) on delete restrict;
create index if not exists samities_branch_idx on public.samities(branch_id);

create table if not exists public.samity_branch_changes (
  id uuid primary key default gen_random_uuid(),
  samity_id uuid not null references public.samities(id) on delete restrict,
  old_branch_id uuid references public.branches(id) on delete restrict,
  new_branch_id uuid not null references public.branches(id) on delete restrict,
  effective_date date not null default current_date,
  reason text not null,
  changed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (old_branch_id is distinct from new_branch_id)
);

alter table public.samity_branch_changes enable row level security;
drop policy if exists samity_branch_changes_read on public.samity_branch_changes;
create policy samity_branch_changes_read on public.samity_branch_changes
for select to authenticated
using (
  public.can_manage_module('samity_branch_transfer','view')
  or public.can_manage_module('samity_branch_transfer','create')
);
drop policy if exists samity_branch_changes_insert on public.samity_branch_changes;
create policy samity_branch_changes_insert on public.samity_branch_changes
for insert to authenticated
with check (
  public.can_manage_module('samity_branch_transfer','create')
  and changed_by = (select auth.uid())
);

create or replace function public.transfer_samity_branch(
  p_samity_id uuid,
  p_new_branch_id uuid,
  p_effective_date date,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_branch_id uuid;
begin
  if auth.uid() is null or not public.can_manage_module('samity_branch_transfer','create') then
    raise exception 'Permission denied';
  end if;
  if p_new_branch_id is null or nullif(trim(p_reason),'') is null then
    raise exception 'নতুন শাখা ও স্থানান্তরের কারণ দিতে হবে';
  end if;
  perform 1 from public.branches where id = p_new_branch_id and is_active = true;
  if not found then raise exception 'নির্বাচিত নতুন শাখাটি সক্রিয় নয় বা পাওয়া যায়নি'; end if;

  select branch_id into v_old_branch_id
  from public.samities where id = p_samity_id for update;
  if not found then raise exception 'Samity not found'; end if;
  if v_old_branch_id = p_new_branch_id then
    raise exception 'নির্বাচিত শাখাটি বর্তমান শাখার একই';
  end if;

  insert into public.samity_branch_changes (
    samity_id, old_branch_id, new_branch_id, effective_date, reason, changed_by
  ) values (
    p_samity_id, v_old_branch_id, p_new_branch_id,
    coalesce(p_effective_date,current_date), trim(p_reason), auth.uid()
  );

  update public.samities set branch_id = p_new_branch_id where id = p_samity_id;
end;
$$;
grant execute on function public.transfer_samity_branch(uuid,uuid,date,text) to authenticated;

drop policy if exists samities_read on public.samities;
create policy samities_read on public.samities for select to authenticated
using (
  public.can_manage_module('samity','view')
  or public.can_manage_module('samity','create')
  or public.can_manage_module('samity','update')
  or public.can_manage_module('samity_day_change','view')
  or public.can_manage_module('samity_day_change','create')
  or public.can_manage_module('samity_branch_transfer','view')
  or public.can_manage_module('samity_branch_transfer','create')
);


-- Atomic samity staff transfer: close previous assignment, add the replacement, and retain history.
create or replace function public.transfer_samity_staff(
  p_samity_id uuid,
  p_new_employee_id uuid,
  p_effective_date date,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_employee_id uuid;
  v_effective_date date := coalesce(p_effective_date,current_date);
begin
  if auth.uid() is null or not public.can_manage_module('samity_staff','create') then
    raise exception 'Permission denied';
  end if;
  if p_new_employee_id is null or nullif(trim(p_reason),'') is null then
    raise exception 'নতুন কর্মী ও পরিবর্তনের কারণ দিতে হবে';
  end if;
  perform 1 from public.employees where id = p_new_employee_id and is_active = true;
  if not found then raise exception 'নির্বাচিত কর্মী সক্রিয় নয় বা পাওয়া যায়নি'; end if;

  select employee_id into v_old_employee_id
  from public.samity_employee_assignments
  where samity_id = p_samity_id and is_active = true
  order by assigned_from desc, created_at desc
  limit 1
  for update;

  if v_old_employee_id = p_new_employee_id then
    raise exception 'নির্বাচিত কর্মী বর্তমানে এই সমিতির দায়িত্বে আছেন';
  end if;

  if v_old_employee_id is not null then
    update public.samity_employee_assignments
    set is_active = false, assigned_to = v_effective_date
    where samity_id = p_samity_id and employee_id = v_old_employee_id and is_active = true;
    insert into public.samity_employee_changes (
      samity_id, employee_id, change_type, effective_date, reason, changed_by
    ) values (
      p_samity_id, v_old_employee_id, 'removed', v_effective_date, trim(p_reason), auth.uid()
    );
  end if;

  insert into public.samity_employee_assignments (
    samity_id, employee_id, assigned_from, is_active, notes, created_by
  ) values (
    p_samity_id, p_new_employee_id, v_effective_date, true, trim(p_reason), auth.uid()
  );

  insert into public.samity_employee_changes (
    samity_id, employee_id, change_type, effective_date, reason, changed_by
  ) values (
    p_samity_id, p_new_employee_id,
    case when v_old_employee_id is null then 'assigned' else 'replaced' end,
    v_effective_date, trim(p_reason), auth.uid()
  );
end;
$$;
grant execute on function public.transfer_samity_staff(uuid,uuid,date,text) to authenticated;
