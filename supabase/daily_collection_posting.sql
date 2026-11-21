-- Daily collection posting, controlled corrections, Day End and Month End.
-- Apply after schema.sql, security.sql and samity_management.sql.

create table if not exists public.daily_collection_sheets (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete restrict,
  samity_id uuid not null references public.samities(id) on delete restrict,
  collection_date date not null,
  status text not null default 'draft' check (status in ('draft','posted','closed')),
  rows jsonb not null default '[]'::jsonb check (jsonb_typeof(rows) = 'array'),
  created_by uuid not null references public.profiles(id),
  posted_by uuid references public.profiles(id),
  posted_at timestamptz,
  closed_by uuid references public.profiles(id),
  closed_at timestamptz,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  unique (samity_id, collection_date)
);
create index if not exists daily_collection_branch_date_idx
  on public.daily_collection_sheets(branch_id, collection_date);
create index if not exists daily_collection_samity_date_idx
  on public.daily_collection_sheets(samity_id, collection_date desc);

create table if not exists public.daily_collection_corrections (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid not null references public.daily_collection_sheets(id) on delete restrict,
  old_rows jsonb not null,
  new_rows jsonb not null,
  reason text not null,
  corrected_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists daily_collection_corrections_sheet_idx
  on public.daily_collection_corrections(sheet_id, created_at desc);

create table if not exists public.collection_month_closures (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete restrict,
  month_start date not null,
  status text not null default 'closed' check (status in ('closed','reopened')),
  totals jsonb not null default '{}'::jsonb,
  closed_by uuid not null references public.profiles(id),
  closed_at timestamptz not null default now(),
  reopened_by uuid references public.profiles(id),
  reopened_at timestamptz,
  reopen_reason text,
  unique (branch_id, month_start),
  check (extract(day from month_start) = 1)
);

alter table public.daily_collection_sheets enable row level security;
alter table public.daily_collection_corrections enable row level security;
alter table public.collection_month_closures enable row level security;

drop policy if exists daily_collection_read on public.daily_collection_sheets;
create policy daily_collection_read on public.daily_collection_sheets
for select to authenticated using (public.can_access_branch(branch_id));
drop policy if exists daily_collection_correction_read on public.daily_collection_corrections;
create policy daily_collection_correction_read on public.daily_collection_corrections
for select to authenticated using (
  exists (select 1 from public.daily_collection_sheets s
          where s.id = sheet_id and public.can_access_branch(s.branch_id))
);
drop policy if exists collection_month_closure_read on public.collection_month_closures;
create policy collection_month_closure_read on public.collection_month_closures
for select to authenticated using (public.can_access_branch(branch_id));

create or replace function public.can_post_collection(p_samity_id uuid)
returns boolean language plpgsql stable security definer set search_path=public as $$
declare v_role text; v_branch uuid; v_employee uuid;
begin
  select role::text, branch_id, employee_id into v_role, v_branch, v_employee
  from public.profiles where id=auth.uid() and is_active=true;
  if v_role in ('main_admin','co_admin') then return true; end if;
  select branch_id into v_branch from public.samities where id=p_samity_id;
  if v_role='branch_manager' then
    return exists(select 1 from public.profiles p join public.samities s on s.id=p_samity_id
      where p.id=auth.uid() and p.is_active and p.branch_id=s.branch_id);
  elsif v_role='area_manager' then
    return exists(select 1 from public.profiles p join public.branches b on b.id=v_branch
      where p.id=auth.uid() and p.is_active and p.area_name=b.area_name);
  elsif v_role='co' then
    return exists(select 1 from public.profiles p
      join public.samity_employee_assignments a on a.employee_id=p.employee_id
      where p.id=auth.uid() and p.is_active and a.samity_id=p_samity_id
        and a.is_active and a.assigned_from<=current_date
        and (a.assigned_to is null or a.assigned_to>=current_date));
  end if;
  return false;
end $$;

create or replace function public.save_daily_collection(
  p_samity_id uuid, p_collection_date date, p_rows jsonb,
  p_action text default 'post', p_reason text default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_sheet public.daily_collection_sheets%rowtype;
  v_branch uuid;
  v_role text;
  v_can_correct boolean;
begin
  if auth.uid() is null or jsonb_typeof(p_rows)<>'array' then
    raise exception 'সঠিক আদায় তথ্য দিন';
  end if;
  if not public.can_post_collection(p_samity_id) then
    raise exception 'এই সমিতিতে আদায় পোস্ট করার অনুমতি নেই';
  end if;
  select branch_id into v_branch from public.samities
    where id=p_samity_id and status='active';
  if v_branch is null then raise exception 'সমিতির শাখা পাওয়া যায়নি বা সমিতি সক্রিয় নয়'; end if;
  if extract(dow from p_collection_date)::integer <> (select meeting_day from public.samities where id=p_samity_id) then
    raise exception 'এই তারিখ সমিতির নির্ধারিত সভার দিন নয়';
  end if;
  if exists(select 1 from public.collection_month_closures
    where branch_id=v_branch and month_start=date_trunc('month',p_collection_date)::date
      and status='closed') then
    raise exception 'এই মাসের হিসাব বন্ধ। সংশোধনের আগে Month Reopen প্রয়োজন';
  end if;

  select * into v_sheet from public.daily_collection_sheets
    where samity_id=p_samity_id and collection_date=p_collection_date for update;

  if found then
    select role::text into v_role from public.profiles where id=auth.uid();
    v_can_correct := v_role in ('main_admin','co_admin','branch_manager')
      or exists(select 1 from public.profile_permissions pp where pp.profile_id=auth.uid() and pp.module_key='collection' and pp.can_update=true);
    if v_sheet.status='closed' then
      raise exception 'Day End সম্পন্ন; সংশোধনের জন্য অনুমোদিত Reopen প্রয়োজন';
    end if;
    if v_sheet.status='posted' and (not v_can_correct or nullif(trim(p_reason),'') is null) then
      raise exception 'ভুল পোস্টিং সংশোধনে অনুমতি ও কারণ আবশ্যক';
    end if;
    if v_sheet.status='posted' then
      insert into public.daily_collection_corrections(sheet_id,old_rows,new_rows,reason,corrected_by)
      values(v_sheet.id,v_sheet.rows,p_rows,trim(p_reason),auth.uid());
    end if;
    update public.daily_collection_sheets set rows=p_rows,
      status=case when p_action='post' then 'posted' else 'draft' end,
      posted_by=case when p_action='post' then auth.uid() else posted_by end,
      posted_at=case when p_action='post' then now() else posted_at end,
      updated_by=auth.uid(),updated_at=now()
    where id=v_sheet.id;
    return v_sheet.id;
  end if;

  if p_action not in ('draft','post') then raise exception 'অবৈধ Posting action'; end if;
  insert into public.daily_collection_sheets(branch_id,samity_id,collection_date,rows,status,created_by,posted_by,posted_at,updated_by)
  values(v_branch,p_samity_id,p_collection_date,p_rows,
    case when p_action='post' then 'posted' else 'draft' end,
    auth.uid(),case when p_action='post' then auth.uid() end,
    case when p_action='post' then now() end,auth.uid())
  returning id into v_sheet.id;
  return v_sheet.id;
end $$;
grant execute on function public.save_daily_collection(uuid,date,jsonb,text,text) to authenticated;

create or replace function public.close_daily_collection(p_sheet_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_sheet public.daily_collection_sheets%rowtype; v_role text;
begin
  select * into v_sheet from public.daily_collection_sheets where id=p_sheet_id for update;
  if not found then raise exception 'দৈনিক আদায় সিট পাওয়া যায়নি'; end if;
  if not public.can_access_branch(v_sheet.branch_id) then raise exception 'শাখার অনুমতি নেই'; end if;
  select role::text into v_role from public.profiles where id=auth.uid() and is_active;
  if not (v_role in ('main_admin','co_admin','branch_manager')
      or exists(select 1 from public.profile_permissions pp where pp.profile_id=auth.uid() and pp.module_key='collection' and pp.can_update=true)) then
    raise exception 'Day End করার অনুমতি নেই';
  end if;
  if v_sheet.status<>'posted' then raise exception 'Day End-এর আগে Posting সম্পন্ন করতে হবে'; end if;
  update public.daily_collection_sheets set status='closed',closed_by=auth.uid(),
    closed_at=now(),updated_by=auth.uid(),updated_at=now() where id=p_sheet_id;
end $$;
grant execute on function public.close_daily_collection(uuid) to authenticated;

create or replace function public.close_collection_month(p_branch_id uuid,p_month_start date)
returns void language plpgsql security definer set search_path=public as $$
declare v_role text; v_totals jsonb;
begin
  select role::text into v_role from public.profiles where id=auth.uid() and is_active;
  if not public.can_access_branch(p_branch_id) or not
    (v_role in ('main_admin','co_admin','branch_manager') or exists(select 1 from public.profile_permissions pp where pp.profile_id=auth.uid() and pp.module_key='collection' and pp.can_update=true)) then
    raise exception 'Month End করার অনুমতি নেই';
  end if;
  if extract(day from p_month_start)<>1 then raise exception 'মাসের প্রথম তারিখ দিতে হবে'; end if;
  if exists(select 1 from public.daily_collection_sheets
    where branch_id=p_branch_id and collection_date>=p_month_start
      and collection_date<(p_month_start+interval '1 month') and status<>'closed') then
    raise exception 'এই মাসের সব দৈনিক আদায় সিট Day End করা হয়নি';
  end if;
  select jsonb_build_object('sheets',count(*),'month',p_month_start)
    into v_totals from public.daily_collection_sheets
    where branch_id=p_branch_id and collection_date>=p_month_start
      and collection_date<(p_month_start+interval '1 month');
  insert into public.collection_month_closures(branch_id,month_start,totals,closed_by)
  values(p_branch_id,p_month_start,v_totals,auth.uid())
  on conflict(branch_id,month_start) do update set
    status='closed',totals=excluded.totals,closed_by=auth.uid(),closed_at=now(),
    reopened_by=null,reopened_at=null,reopen_reason=null;
end $$;
grant execute on function public.close_collection_month(uuid,date) to authenticated;

create or replace function public.reopen_collection_month(
  p_branch_id uuid,p_month_start date,p_reason text
) returns void language plpgsql security definer set search_path=public as $$
declare v_role text;
begin
  select role::text into v_role from public.profiles where id=auth.uid() and is_active;
  if not public.can_access_branch(p_branch_id) or not
    (v_role in ('main_admin','co_admin') or exists(select 1 from public.profile_permissions pp where pp.profile_id=auth.uid() and pp.module_key='collection' and pp.can_update=true)) then
    raise exception 'Month Reopen করার অনুমতি নেই';
  end if;
  if nullif(trim(p_reason),'') is null then raise exception 'Reopen-এর কারণ লিখুন'; end if;
  update public.collection_month_closures set status='reopened',reopened_by=auth.uid(),
    reopened_at=now(),reopen_reason=trim(p_reason)
  where branch_id=p_branch_id and month_start=p_month_start and status='closed';
  if not found then raise exception 'বন্ধ মাসের হিসাব পাওয়া যায়নি'; end if;
end $$;
grant execute on function public.reopen_collection_month(uuid,date,text) to authenticated;
