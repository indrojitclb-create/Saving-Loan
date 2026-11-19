-- Recalculate future unpaid loan installments when a holiday or samity closure changes.
-- Apply once in Supabase SQL Editor after loan_collection.sql and holiday_calendar.sql.

create or replace function public.reschedule_unpaid_loan_installments(p_loan_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $reschedule$
declare
  v_samity_id uuid;
  v_meeting_day smallint;
  v_row record;
  v_candidate date;
  v_previous_date date := null;
  v_ids uuid[] := array[]::uuid[];
  v_dates date[] := array[]::date[];
  v_i integer;
  v_count integer;
begin
  select m.samity_id, sm.meeting_day into v_samity_id, v_meeting_day
  from public.loan_accounts a
  join public.members m on m.id = a.member_id
  join public.samities sm on sm.id = m.samity_id
  where a.id = p_loan_id and a.status = 'active';

  if v_samity_id is null or v_meeting_day = 5 then return; end if;

  -- Calculate the complete target sequence first. This preserves weekly order
  -- and reserves paid/historical dates before any unique due_date is updated.
  for v_row in
    select id, due_date, status, total_due, principal_paid, service_charge_paid
    from public.loan_installment_schedule
    where loan_id = p_loan_id
    order by week_no
  loop
    v_candidate := v_row.due_date;

    if v_row.status <> 'paid'
       and coalesce(v_row.principal_paid,0) + coalesce(v_row.service_charge_paid,0) < coalesce(v_row.total_due,0) - 0.005
       and v_row.due_date >= current_date then
      loop
        exit when not public.is_holiday_for_samity(v_samity_id, v_candidate)
          and (v_previous_date is null or v_candidate > v_previous_date)
          and not (v_candidate = any(v_dates))
          and not exists (
            select 1
            from public.loan_installment_schedule fixed
            where fixed.loan_id = p_loan_id
              and fixed.id <> v_row.id
              and (fixed.status = 'paid'
                or coalesce(fixed.principal_paid,0) + coalesce(fixed.service_charge_paid,0) >= coalesce(fixed.total_due,0) - 0.005
                or fixed.due_date < current_date)
              and fixed.due_date = v_candidate
          );
        v_candidate := v_candidate + 7;
      end loop;
    end if;

    v_ids := array_append(v_ids, v_row.id);
    v_dates := array_append(v_dates, v_candidate);
    v_previous_date := v_candidate;
  end loop;

  -- Update from the last installment backwards so the unique (loan_id,due_date)
  -- constraint never blocks an earlier installment taking a freed date.
  v_count := coalesce(array_length(v_ids, 1), 0);
  if v_count > 0 then
    for v_i in reverse v_count..1 loop
      update public.loan_installment_schedule
      set due_date = v_dates[v_i]
      where id = v_ids[v_i]
        and due_date is distinct from v_dates[v_i];
    end loop;
  end if;

  update public.loan_accounts a
  set first_installment_date = (
    select s.due_date from public.loan_installment_schedule s
    where s.loan_id = p_loan_id and s.week_no = 1
  )
  where a.id = p_loan_id;
end;
$reschedule$;

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
  return null;
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

-- Database-level protection: loans cannot be disbursed to legacy samities
-- whose meeting weekday is Friday, even if the client-side form is bypassed.
create or replace function public.prevent_friday_loan_disbursement()
returns trigger
language plpgsql
security definer
set search_path = public
as $friday_loan$
declare
  v_meeting_day smallint;
begin
  select sm.meeting_day into v_meeting_day
  from public.members m
  join public.samities sm on sm.id = m.samity_id
  where m.id = new.member_id;

  if v_meeting_day = 5 then
    raise exception 'শুক্রবার সভার দিন থাকা সমিতিতে নতুন ঋণ বিতরণ করা যাবে না। আগে সমিতির সভার দিন সংশোধন করুন।';
  end if;
  return new;
end;
$friday_loan$;

drop trigger if exists loan_accounts_no_friday_samity on public.loan_accounts;
create trigger loan_accounts_no_friday_samity
before insert or update of member_id, disbursement_date on public.loan_accounts
for each row execute function public.prevent_friday_loan_disbursement();

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


-- These maintenance functions are intended to run only from database triggers.
revoke all on function public.reschedule_unpaid_loan_installments(uuid) from public, anon, authenticated;
revoke all on function public.reschedule_all_active_loan_installments() from public, anon, authenticated;
revoke all on function public.trigger_reschedule_after_holiday_change() from public, anon, authenticated;
revoke all on function public.prevent_friday_samity_meeting() from public, anon, authenticated;
revoke all on function public.prevent_friday_loan_disbursement() from public, anon, authenticated;

-- Apply the currently registered holidays to already-existing active loan schedules.
select public.reschedule_all_active_loan_installments();
