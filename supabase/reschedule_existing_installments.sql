-- Reflow existing unpaid loan installments when a holiday or samity closure is added.
-- Apply after loan_collection.sql and holiday_calendar.sql.
-- Paid installments and all loan_transactions are intentionally left unchanged.

-- Allow the complete weekly sequence to be updated atomically without transient
-- collisions against the (loan_id, due_date) uniqueness rule.
alter table public.loan_installment_schedule
  drop constraint if exists loan_installment_schedule_loan_id_due_date_key;
alter table public.loan_installment_schedule
  add constraint loan_installment_schedule_loan_id_due_date_key
  unique (loan_id, due_date) deferrable initially deferred;

create or replace function public.reschedule_unpaid_installments_for_samity(p_samity_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loan record;
  v_row record;
  v_candidate date;
  v_previous_date date;
  v_changed integer := 0;
begin
  if p_samity_id is null then return 0; end if;

  -- Serialize concurrent calendar changes for this samity.
  perform 1 from public.samities where id = p_samity_id for update;
  if not found then return 0; end if;

  set constraints loan_installment_schedule_loan_id_due_date_key deferred;

  for v_loan in
    select a.id
    from public.loan_accounts a
    join public.members m on m.id = a.member_id
    where m.samity_id = p_samity_id
      and a.status = 'active'
    order by a.id
  loop
    v_previous_date := null;

    for v_row in
      select id, due_date, total_due, principal_paid, service_charge_paid, status
      from public.loan_installment_schedule
      where loan_id = v_loan.id
      order by week_no
      for update
    loop
      -- A fully paid row is historical: never change its due date.
      if v_row.status = 'paid'
         or (coalesce(v_row.principal_paid,0) + coalesce(v_row.service_charge_paid,0))
              >= coalesce(v_row.total_due,0) - 0.005 then
        v_previous_date := v_row.due_date;
        continue;
      end if;

      v_candidate := v_row.due_date;

      -- Keep the weekly meeting weekday and preserve sequence after the prior row.
      if v_previous_date is not null and v_candidate <= v_previous_date then
        v_candidate := v_previous_date + 7;
      end if;
      while public.is_holiday_for_samity(p_samity_id, v_candidate) loop
        v_candidate := v_candidate + 7;
      end loop;

      if v_candidate <> v_row.due_date then
        update public.loan_installment_schedule
        set due_date = v_candidate
        where id = v_row.id;
        v_changed := v_changed + 1;
      end if;

      v_previous_date := v_candidate;
    end loop;
  end loop;

  return v_changed;
end;
$$;

create or replace function public.reschedule_all_samity_installments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_samity record;
begin
  -- Re-evaluate all samities so organization/branch-wide holidays and changes
  -- to the Friday setting cannot leave an existing schedule out of date.
  for v_samity in
    select distinct m.samity_id
    from public.members m
    join public.loan_accounts a on a.member_id = m.id
    join public.loan_installment_schedule s on s.loan_id = a.id
    where a.status = 'active'
  loop
    perform public.reschedule_unpaid_installments_for_samity(v_samity.samity_id);
  end loop;
  return null;
end;
$$;

drop trigger if exists holiday_calendar_reschedule_existing_loans on public.holiday_calendar;
create trigger holiday_calendar_reschedule_existing_loans
after insert or update or delete on public.holiday_calendar
for each statement execute function public.reschedule_all_samity_installments();

drop trigger if exists samity_closure_reschedule_existing_loans on public.samity_week_closures;
create trigger samity_closure_reschedule_existing_loans
after insert or update or delete on public.samity_week_closures
for each statement execute function public.reschedule_all_samity_installments();

drop trigger if exists holiday_settings_reschedule_existing_loans on public.holiday_calendar_settings;
create trigger holiday_settings_reschedule_existing_loans
after update on public.holiday_calendar_settings
for each statement execute function public.reschedule_all_samity_installments();

-- Friday is not an allowed weekly meeting day for new or changed samities.
-- NOT VALID preserves any legacy rows while enforcing the rule for new writes.
do $$
begin
  if not exists (select 1 from pg_constraint where conname='samities_no_friday_meeting' and conrelid='public.samities'::regclass) then
    alter table public.samities add constraint samities_no_friday_meeting
      check (meeting_day <> 5) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname='samity_meeting_changes_no_friday' and conrelid='public.samity_meeting_changes'::regclass) then
    alter table public.samity_meeting_changes add constraint samity_meeting_changes_no_friday
      check (old_day <> 5 and new_day <> 5) not valid;
  end if;
end $$;

-- Guard the atomic meeting-day RPC as well.
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
  if p_new_day not between 0 and 6 or p_new_day = 5
     or nullif(trim(p_new_place),'') is null or nullif(trim(p_reason),'') is null then
    raise exception 'শুক্রবার সমিতির সভার দিন হতে পারবে না। বৈধ দিন, সভাস্থল ও পরিবর্তনের কারণ দিন।';
  end if;
  select * into v_old from public.samities where id = p_samity_id for update;
  if not found then raise exception 'Samity not found'; end if;
  if v_old.meeting_day = 5 then
    raise exception 'এই সমিতির বর্তমান সভার দিন শুক্রবার। আগে Main Admin-এর মাধ্যমে বৈধ সভার দিন নির্ধারণ করুন।';
  end if;

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
