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

-- Each generated ledger row is traceable to the daily sheet that created it.
alter table public.savings_transactions
  add column if not exists collection_sheet_id uuid references public.daily_collection_sheets(id) on delete restrict;
alter table public.loan_transactions
  add column if not exists collection_sheet_id uuid references public.daily_collection_sheets(id) on delete restrict;
alter table public.savings_transactions drop constraint if exists savings_transactions_savings_category_check;
alter table public.savings_transactions add constraint savings_transactions_savings_category_check
  check (savings_category in ('GS','LTS-New','Optional'));
create index if not exists savings_tx_collection_sheet_idx
  on public.savings_transactions(collection_sheet_id) where collection_sheet_id is not null;
create index if not exists loan_tx_collection_sheet_idx
  on public.loan_transactions(collection_sheet_id) where collection_sheet_id is not null;

create table if not exists public.daily_collection_reopens (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid not null references public.daily_collection_sheets(id) on delete restrict,
  reason text not null,
  reopened_by uuid not null references public.profiles(id),
  reopened_at timestamptz not null default now()
);


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
alter table public.daily_collection_reopens enable row level security;
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
drop policy if exists daily_collection_reopens_read on public.daily_collection_reopens;
create policy daily_collection_reopens_read on public.daily_collection_reopens
for select to authenticated using (exists(select 1 from public.daily_collection_sheets s
  where s.id=sheet_id and public.can_access_branch(s.branch_id)));
drop policy if exists collection_month_closure_read on public.collection_month_closures;
create policy collection_month_closure_read on public.collection_month_closures
for select to authenticated using (public.can_access_branch(branch_id));

create or replace function public.can_post_collection(p_samity_id uuid,p_collection_date date)
returns boolean language plpgsql stable security definer set search_path=public as $
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
        and a.is_active and a.assigned_from<=p_collection_date
        and (a.assigned_to is null or a.assigned_to>=p_collection_date));
  end if;
  return false;
end $$;

create or replace function public.save_daily_collection(
 p_samity_id uuid,p_collection_date date,p_rows jsonb,p_action text default 'post',p_reason text default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare
 v_sheet public.daily_collection_sheets%rowtype; v_branch uuid; v_role text; v_allowed boolean;
 r jsonb; v_member uuid; v_amt numeric(14,2); v_left numeric(14,2);
 sc record; v_service numeric(14,2); v_principal numeric(14,2); v_loan uuid; v_enroll uuid;
begin
 if auth.uid() is null or jsonb_typeof(p_rows)<>'array' or p_action not in ('draft','post') then
   raise exception 'সঠিক আদায় তথ্য দিন';
 end if;
 if not public.can_post_collection(p_samity_id,p_collection_date) then
   raise exception 'এই সমিতিতে পোস্ট করার অনুমতি নেই';
 end if;
 select branch_id into v_branch from public.samities where id=p_samity_id and status='active';
 if v_branch is null then raise exception 'সমিতি সক্রিয় নয় অথবা শাখা নির্ধারিত নেই'; end if;
 if extract(dow from p_collection_date)::integer<>(select meeting_day from public.samities where id=p_samity_id) then
   raise exception 'এই তারিখ সমিতির সভার দিন নয়';
 end if;
 if exists(select 1 from public.collection_month_closures where branch_id=v_branch
   and month_start=date_trunc('month',p_collection_date)::date and status='closed') then
   raise exception 'Month End বন্ধ; আগে Month Reopen প্রয়োজন';
 end if;
 if jsonb_array_length(p_rows)<>(select count(*) from public.members
   where samity_id=p_samity_id and branch_id=v_branch and is_active) then
   raise exception 'সক্রিয় প্রত্যেক সদস্যের জন্য একটি করে সারি থাকতে হবে';
 end if;
 if exists(select 1 from (select value->>'member_id' from jsonb_array_elements(p_rows)
   group by value->>'member_id' having count(*)>1) d) then
   raise exception 'একই সদস্যের একাধিক সারি গ্রহণযোগ্য নয়';
 end if;
 for r in select value from jsonb_array_elements(p_rows) loop
   v_member:=nullif(r->>'member_id','')::uuid;
   if not exists(select 1 from public.members where id=v_member and samity_id=p_samity_id
     and branch_id=v_branch and is_active) then raise exception 'সদস্য এই সমিতির নন'; end if;
   if least(coalesce((r->>'gs_deposit')::numeric,0),coalesce((r->>'gs_withdrawal')::numeric,0),
     coalesce((r->>'lts_new')::numeric,0),coalesce((r->>'optional_savings')::numeric,0),
     coalesce((r->>'loan_paid')::numeric,0))<0 then raise exception 'ঋণাত্মক অঙ্ক গ্রহণযোগ্য নয়'; end if;
   if coalesce((r->>'optional_savings')::numeric,0)>0 then
     v_enroll:=nullif(r->>'optional_enrollment_id','')::uuid;
     if not exists(select 1 from public.member_savings_enrollments where id=v_enroll
       and member_id=v_member and savings_type='optional') then raise exception 'ঐচ্ছিক সঞ্চয় স্কিম নির্বাচন করুন'; end if;
   end if;
   if coalesce((r->>'loan_paid')::numeric,0)>0 then
     v_loan:=nullif(r->>'loan_id','')::uuid;
     if not exists(select 1 from public.loan_accounts where id=v_loan and member_id=v_member and status='active') then
       raise exception 'সক্রিয় ঋণ নির্বাচন করুন'; end if;
   end if;
 end loop;

 select * into v_sheet from public.daily_collection_sheets where samity_id=p_samity_id
   and collection_date=p_collection_date for update;
 if found then
   select role::text into v_role from public.profiles where id=auth.uid() and is_active;
   v_allowed:=v_role in ('main_admin','co_admin','branch_manager') or exists(
     select 1 from public.profile_permissions where profile_id=auth.uid()
       and module_key='collection' and can_update);
   if v_sheet.status='closed' then raise exception 'Day End সম্পন্ন; আগে Day Reopen করুন'; end if;
   if v_sheet.status='posted' and (not v_allowed or nullif(trim(p_reason),'') is null) then
     raise exception 'সংশোধনের অনুমতি ও কারণ আবশ্যক'; end if;
   if v_sheet.status='posted' then
     insert into public.daily_collection_corrections(sheet_id,old_rows,new_rows,reason,corrected_by)
       values(v_sheet.id,v_sheet.rows,p_rows,trim(p_reason),auth.uid());
     delete from public.savings_transactions where collection_sheet_id=v_sheet.id;
     delete from public.loan_transactions where collection_sheet_id=v_sheet.id;
     update public.loan_installment_schedule s set
       principal_paid=coalesce((select sum(t.principal_paid) from public.loan_transactions t where t.schedule_id=s.id),0),
       service_charge_paid=coalesce((select sum(t.interest_paid) from public.loan_transactions t where t.schedule_id=s.id),0),
       status=case when coalesce((select sum(t.amount) from public.loan_transactions t where t.schedule_id=s.id),0)>=s.total_due then 'paid'
         when coalesce((select sum(t.amount) from public.loan_transactions t where t.schedule_id=s.id),0)>0 then 'partial'
         when s.due_date<current_date then 'overdue' else 'due' end
     where s.loan_id in(select id from public.loan_accounts where member_id in
       (select id from public.members where samity_id=p_samity_id));
   end if;
   update public.daily_collection_sheets set rows=p_rows,status=case when p_action='post' then 'posted' else 'draft' end,
     posted_by=case when p_action='post' then auth.uid() else posted_by end,
     posted_at=case when p_action='post' then now() else posted_at end,updated_by=auth.uid(),updated_at=now()
     where id=v_sheet.id;
 else
   insert into public.daily_collection_sheets(branch_id,samity_id,collection_date,rows,status,created_by,posted_by,posted_at,updated_by)
     values(v_branch,p_samity_id,p_collection_date,p_rows,case when p_action='post' then 'posted' else 'draft' end,
       auth.uid(),case when p_action='post' then auth.uid() end,case when p_action='post' then now() end,auth.uid())
     returning * into v_sheet;
 end if;

 if p_action='post' then
   for r in select value from jsonb_array_elements(p_rows) loop
     v_member:=nullif(r->>'member_id','')::uuid;
     v_amt:=coalesce((r->>'gs_deposit')::numeric,0);
     if v_amt>0 then insert into public.savings_transactions(member_id,transaction_date,transaction_type,amount,created_by,savings_category,collection_sheet_id)
       values(v_member,p_collection_date,'deposit',v_amt,auth.uid(),'GS',v_sheet.id); end if;
     v_amt:=coalesce((r->>'gs_withdrawal')::numeric,0);
     if v_amt>0 then
       if v_amt>coalesce((select sum(case when transaction_type='deposit' then amount else -amount end)
         from public.savings_transactions where member_id=v_member and savings_category='GS'
         and transaction_date<=p_collection_date),0) then raise exception 'GS স্থিতির চেয়ে বেশি উত্তোলন করা যাবে না'; end if;
       insert into public.savings_transactions(member_id,transaction_date,transaction_type,amount,created_by,savings_category,collection_sheet_id)
         values(v_member,p_collection_date,'withdrawal',v_amt,auth.uid(),'GS',v_sheet.id);
     end if;
     v_amt:=coalesce((r->>'lts_new')::numeric,0);
     if v_amt>0 then insert into public.savings_transactions(member_id,transaction_date,transaction_type,amount,created_by,savings_category,collection_sheet_id)
       values(v_member,p_collection_date,'deposit',v_amt,auth.uid(),'LTS-New',v_sheet.id); end if;
     v_amt:=coalesce((r->>'optional_savings')::numeric,0);
     if v_amt>0 then insert into public.savings_transactions(member_id,transaction_date,transaction_type,amount,created_by,savings_category,enrollment_id,collection_sheet_id)
       values(v_member,p_collection_date,'deposit',v_amt,auth.uid(),'Optional',nullif(r->>'optional_enrollment_id','')::uuid,v_sheet.id); end if;
     v_left:=coalesce((r->>'loan_paid')::numeric,0);
     if v_left>0 then
       v_loan:=nullif(r->>'loan_id','')::uuid;
       for sc in select * from public.loan_installment_schedule where loan_id=v_loan and status<>'paid'
         order by due_date,week_no for update loop
         exit when v_left<=0;
         v_amt:=greatest(0,sc.total_due-sc.principal_paid-sc.service_charge_paid);
         if v_amt=0 then continue; end if;
         v_amt:=least(v_amt,v_left);
         v_service:=least(v_amt,greatest(0,sc.service_charge_due-sc.service_charge_paid));
         v_principal:=v_amt-v_service;
         insert into public.loan_transactions(loan_id,transaction_date,amount,principal_paid,interest_paid,schedule_id,created_by,collection_sheet_id)
           values(v_loan,p_collection_date,v_amt,v_principal,v_service,sc.id,auth.uid(),v_sheet.id);
         update public.loan_installment_schedule set principal_paid=principal_paid+v_principal,
           service_charge_paid=service_charge_paid+v_service,
           status=case when principal_paid+v_principal+service_charge_paid+v_service>=total_due then 'paid' else 'partial' end
           where id=sc.id;
         v_left:=v_left-v_amt;
       end loop;
       if v_left>0 then raise exception 'ঋণের অবশিষ্ট কিস্তির চেয়ে বেশি আদায়'; end if;
     end if;
   end loop;
 end if;
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

create or replace function public.reopen_daily_collection(p_sheet_id uuid,p_reason text)
returns void language plpgsql security definer set search_path=public as $
declare v_sheet public.daily_collection_sheets%rowtype; v_role text;
begin
 select * into v_sheet from public.daily_collection_sheets where id=p_sheet_id for update;
 if not found then raise exception 'দৈনিক আদায় সিট পাওয়া যায়নি'; end if;
 select role::text into v_role from public.profiles where id=auth.uid() and is_active;
 if not public.can_access_branch(v_sheet.branch_id) or not
   (v_role in ('main_admin','co_admin','branch_manager') or exists(
     select 1 from public.profile_permissions pp where pp.profile_id=auth.uid()
       and pp.module_key='collection' and pp.can_update=true)) then
   raise exception 'Day Reopen করার অনুমতি নেই';
 end if;
 if nullif(trim(p_reason),'') is null then raise exception 'Reopen-এর কারণ লিখুন'; end if;
 if v_sheet.status<>'closed' then raise exception 'এই সিট Day End করা হয়নি'; end if;
 if exists(select 1 from public.collection_month_closures c where c.branch_id=v_sheet.branch_id
   and c.month_start=date_trunc('month',v_sheet.collection_date)::date and c.status='closed') then
   raise exception 'Month End বন্ধ; আগে Month Reopen করুন';
 end if;
 insert into public.daily_collection_reopens(sheet_id,reason,reopened_by)
 values(p_sheet_id,trim(p_reason),auth.uid());
 update public.daily_collection_sheets set status='posted',closed_by=null,closed_at=null,
   updated_by=auth.uid(),updated_at=now() where id=p_sheet_id;
end $;
grant execute on function public.reopen_daily_collection(uuid,text) to authenticated;

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
  if p_month_start >= date_trunc('month',current_date)::date then
    raise exception 'মাস শেষ হওয়ার পর Month End করা যাবে';
  end if;
  if not exists(select 1 from public.daily_collection_sheets
    where branch_id=p_branch_id and collection_date>=p_month_start
      and collection_date<(p_month_start+interval '1 month')) then
    raise exception 'এই মাসে কোনো দৈনিক আদায় সিট পাওয়া যায়নি';
  end if;
  if exists(select 1 from public.daily_collection_sheets
    where branch_id=p_branch_id and collection_date>=p_month_start
      and collection_date<(p_month_start+interval '1 month') and status<>'closed') then
    raise exception 'এই মাসের সব দৈনিক আদায় সিট Day End করা হয়নি';
  end if;
  -- Require a closed sheet for every scheduled Samity meeting day, excluding
  -- registered Samity closures and the central holiday calendar.
  if exists(
    select 1 from public.samities s
    cross join generate_series(p_month_start::timestamp,
      (p_month_start+interval '1 month - 1 day')::timestamp,interval '1 day') d(day_date)
    where s.branch_id=p_branch_id and s.status='active'
      and (s.start_date is null or s.start_date<=d.day_date::date)
      and extract(dow from d.day_date)::integer=s.meeting_day
      and not exists(select 1 from public.samity_week_closures c
        where c.samity_id=s.id and c.closure_date=d.day_date::date)
      and not exists(select 1 from public.holiday_calendar h
        where h.is_active and d.day_date::date between h.date_from and h.date_to
          and (h.scope='organization'
            or (h.scope='branch' and h.branch_id=p_branch_id)
            or (h.scope='samity' and h.samity_id=s.id)))
      and not (s.meeting_day=5 and coalesce((select friday_holiday_enabled
        from public.holiday_calendar_settings where id=1),false))
      and not exists(select 1 from public.daily_collection_sheets ds
        where ds.samity_id=s.id and ds.collection_date=d.day_date::date and ds.status='closed')
  ) then
    raise exception 'এই মাসের সব নির্ধারিত সমিতির সভার আদায় সিট পোস্ট ও Day End সম্পন্ন হয়নি';
  end if;
  select jsonb_build_object(
    'month',p_month_start,
    'sheet_count',(select count(*) from public.daily_collection_sheets
      where branch_id=p_branch_id and collection_date>=p_month_start
        and collection_date<(p_month_start+interval '1 month')),
    'gs_deposit',coalesce((select sum((r.value->>'gs_deposit')::numeric)
      from public.daily_collection_sheets s cross join lateral jsonb_array_elements(s.rows) r(value)
      where s.branch_id=p_branch_id and s.collection_date>=p_month_start
        and s.collection_date<(p_month_start+interval '1 month')),0),
    'gs_withdrawal',coalesce((select sum((r.value->>'gs_withdrawal')::numeric)
      from public.daily_collection_sheets s cross join lateral jsonb_array_elements(s.rows) r(value)
      where s.branch_id=p_branch_id and s.collection_date>=p_month_start
        and s.collection_date<(p_month_start+interval '1 month')),0),
    'lts_new_collected',coalesce((select sum((r.value->>'lts_new')::numeric)
      from public.daily_collection_sheets s cross join lateral jsonb_array_elements(s.rows) r(value)
      where s.branch_id=p_branch_id and s.collection_date>=p_month_start
        and s.collection_date<(p_month_start+interval '1 month')),0),
    'optional_savings_collected',coalesce((select sum((r.value->>'optional_savings')::numeric)
      from public.daily_collection_sheets s cross join lateral jsonb_array_elements(s.rows) r(value)
      where s.branch_id=p_branch_id and s.collection_date>=p_month_start
        and s.collection_date<(p_month_start+interval '1 month')),0),
    'loan_collected',coalesce((select sum(t.amount) from public.loan_transactions t
      join public.loan_accounts a on a.id=t.loan_id join public.members m on m.id=a.member_id
      where m.branch_id=p_branch_id and t.transaction_date>=p_month_start
        and t.transaction_date<(p_month_start+interval '1 month')),0),
    'loan_due',coalesce((select sum(sc.total_due) from public.loan_installment_schedule sc
      join public.loan_accounts a on a.id=sc.loan_id join public.members m on m.id=a.member_id
      where m.branch_id=p_branch_id and sc.due_date>=p_month_start
        and sc.due_date<(p_month_start+interval '1 month')),0),
    'gs_closing_balance',coalesce((select sum(case when t.transaction_type='deposit' then t.amount else -t.amount end)
      from public.savings_transactions t join public.members m on m.id=t.member_id
      where m.branch_id=p_branch_id and t.savings_category='GS'
        and t.transaction_date<(p_month_start+interval '1 month')),0),
    'lts_new_closing_balance',coalesce((select sum(case when t.transaction_type='deposit' then t.amount else -t.amount end)
      from public.savings_transactions t join public.members m on m.id=t.member_id
      where m.branch_id=p_branch_id and t.savings_category='LTS-New'
        and t.transaction_date<(p_month_start+interval '1 month')),0),
    'optional_savings_closing_balance',coalesce((select sum(case when t.transaction_type='deposit' then t.amount else -t.amount end)
      from public.savings_transactions t join public.members m on m.id=t.member_id
      where m.branch_id=p_branch_id and t.savings_category='Optional'
        and t.transaction_date<(p_month_start+interval '1 month')),0),
    'loan_outstanding',coalesce((select sum(greatest(0,coalesce(a.total_repayable,a.principal+a.total_service_charge,0)-
      coalesce((select sum(t.amount) from public.loan_transactions t where t.loan_id=a.id
        and t.transaction_date<(p_month_start+interval '1 month')),0)))
      from public.loan_accounts a join public.members m on m.id=a.member_id
      where m.branch_id=p_branch_id and a.disbursement_date<(p_month_start+interval '1 month')
        and a.status='active'),0)
  ) into v_totals;
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
    (v_role in ('main_admin','co_admin','branch_manager') or exists(select 1 from public.profile_permissions pp where pp.profile_id=auth.uid() and pp.module_key='collection' and pp.can_update=true)) then
    raise exception 'Month Reopen করার অনুমতি নেই';
  end if;
  if nullif(trim(p_reason),'') is null then raise exception 'Reopen-এর কারণ লিখুন'; end if;
  update public.collection_month_closures set status='reopened',reopened_by=auth.uid(),
    reopened_at=now(),reopen_reason=trim(p_reason)
  where branch_id=p_branch_id and month_start=p_month_start and status='closed';
  if not found then raise exception 'বন্ধ মাসের হিসাব পাওয়া যায়নি'; end if;
end $$;
grant execute on function public.reopen_collection_month(uuid,date,text) to authenticated;
