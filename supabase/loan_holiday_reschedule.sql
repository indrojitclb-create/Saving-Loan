-- Recalculate future unpaid loan installments when a holiday or samity closure changes.
-- Apply once in Supabase SQL Editor after loan_collection.sql and holiday_calendar.sql.

create or replace function public.reschedule_unpaid_loan_installments(p_loan_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_samity_id uuid;
  v_row record;
  v_candidate date;
  v_previous_date date := null;
begin
  select m.samity_id into v_samity_id
  from public.loan_accounts a
  join public.members m on m.id = a.member_id
  where a.id = p_loan_id and a.status = 'active';

  if v_samity_id is null then return; end if;

  for v_row in
    select id, due_date, status
    from public.loan_installment_schedule
    where loan_id = p_loan_id
    order by week_no
    for update
  loop
    -- Paid installments and historical unpaid installments are immutable.
    if v_row.status = 'paid' or v_row.due_date < current_date then
      v_previous_date := v_row.due_date;
      continue;
    end if;

    v_candidate := v_row.due_date;
    if v_previous_date is not null and v_candidate <= v_previous_date then
      v_candidate := v_previous_date + 7;
    end if;

    -- Move only by whole weeks: the samity meeting weekday never changes.
    while public.is_holiday_for_samity(v_samity_id, v_candidate)
       or exists (
         select 1
         from public.loan_installment_schedule occupied
         where occupied.loan_id = p_loan_id
           and occupied.id <> v_row.id
           and occupied.due_date = v_candidate
       )
    loop
      v_candidate := v_candidate + 7;
    end loop;

    if v_candidate <> v_row.due_date then
      update public.loan_installment_schedule
      set due_date = v_candidate
      where id = v_row.id;
    end if;
    v_previous_date := v_candidate;
  end loop;
end;
$$;

create or replace function public.reschedule_all_active_loan_installments()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loan_id uuid;
begin
  for v_loan_id in
    select id from public.loan_accounts where status = 'active'
  loop
    perform public.reschedule_unpaid_loan_installments(v_loan_id);
  end loop;
end;
$$;

create or replace function public.trigger_reschedule_after_holiday_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.reschedule_all_active_loan_installments();
  return coalesce(new, old);
end;
$$;

drop trigger if exists holiday_calendar_reschedule_installments on public.holiday_calendar;
create trigger holiday_calendar_reschedule_installments
after insert or update or delete on public.holiday_calendar
for each row execute function public.trigger_reschedule_after_holiday_change();

drop trigger if exists samity_closure_reschedule_installments on public.samity_week_closures;
create trigger samity_closure_reschedule_installments
after insert or update or delete on public.samity_week_closures
for each row execute function public.trigger_reschedule_after_holiday_change();

drop trigger if exists holiday_settings_reschedule_installments on public.holiday_calendar_settings;
create trigger holiday_settings_reschedule_installments
after update of friday_holiday_enabled on public.holiday_calendar_settings
for each row execute function public.trigger_reschedule_after_holiday_change();

-- Friday (PostgreSQL DOW = 5) is never a valid weekly samity meeting day.
create or replace function public.prevent_friday_samity_meeting()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.meeting_day = 5 then
    raise exception 'শুক্রবার কোনো সমিতির সভার দিন হতে পারবে না।';
  end if;
  return new;
end;
$$;

drop trigger if exists samities_no_friday_meeting on public.samities;
create trigger samities_no_friday_meeting
before insert or update of meeting_day on public.samities
for each row execute function public.prevent_friday_samity_meeting();

-- Re-check old Friday meeting assignments as an explicit migration warning.
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.samities where meeting_day = 5;
  if v_count > 0 then
    raise notice 'There are % existing samities assigned to Friday. Change those meeting days before creating new loans for them.', v_count;
  end if;
end;
$$;

