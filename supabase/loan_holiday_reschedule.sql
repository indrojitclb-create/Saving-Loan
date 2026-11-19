-- Reflow unpaid weekly loan installments after a newly registered holiday or samity closure.
-- Run after loan_collection.sql and holiday_calendar.sql.
-- Paid installment dates and all loan transactions are left unchanged.

alter table public.loan_installment_schedule
  drop constraint if exists loan_installment_schedule_loan_id_due_date_key;

alter table public.loan_installment_schedule
  add constraint loan_installment_schedule_loan_id_due_date_key
  unique (loan_id, due_date) deferrable initially deferred;

create or replace function public.reschedule_unpaid_samity_installments(
  p_samity_id uuid,
  p_closed_from date,
  p_closed_to date
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loan record;
  v_row record;
  v_first_week integer;
  v_previous_date date;
  v_candidate date;
  v_changed integer := 0;
begin
  if p_samity_id is null or p_closed_from is null or p_closed_to is null
     or p_closed_to < p_closed_from then
    return 0;
  end if;

  -- Defer the per-loan due-date uniqueness check so weekly rows can move
  -- forward together without transient collisions with their old dates.
  set constraints loan_installment_schedule_loan_id_due_date_key deferred;

  for v_loan in
    select a.id
    from public.loan_accounts a
    join public.members m on m.id = a.member_id
    where m.samity_id = p_samity_id
      and a.status = 'active'
      and exists (
        select 1
        from public.loan_installment_schedule s
        where s.loan_id = a.id
          and s.due_date between p_closed_from and p_closed_to
          and s.status <> 'paid'
          and (s.principal_paid + s.service_charge_paid) < s.total_due
      )
    order by a.id
  loop
    select min(s.week_no) into v_first_week
    from public.loan_installment_schedule s
    where s.loan_id = v_loan.id
      and s.due_date between p_closed_from and p_closed_to
      and s.status <> 'paid'
      and (s.principal_paid + s.service_charge_paid) < s.total_due;

    v_previous_date := null;

    for v_row in
      select s.id, s.week_no, s.due_date, s.total_due,
             s.principal_paid, s.service_charge_paid, s.status
      from public.loan_installment_schedule s
      where s.loan_id = v_loan.id
        and s.week_no >= v_first_week
      order by s.week_no
      for update
    loop
      -- Fully paid rows are historical: never move their due date.
      if v_row.status = 'paid'
         or (v_row.principal_paid + v_row.service_charge_paid) >= v_row.total_due then
        v_previous_date := v_row.due_date;
        continue;
      end if;

      if v_previous_date is null then
        v_candidate := v_row.due_date;
      else
        v_candidate := v_previous_date + 7;
      end if;

      -- Keep the same weekday. Skip all holidays/closures and any fixed,
      -- already-paid installment date. Partial payments remain attached
      -- to the same schedule row and are not changed.
      while public.is_holiday_for_samity(p_samity_id, v_candidate)
         or exists (
           select 1
           from public.loan_installment_schedule fixed
           where fixed.loan_id = v_loan.id
             and fixed.id <> v_row.id
             and (
               fixed.status = 'paid'
               or (fixed.principal_paid + fixed.service_charge_paid) >= fixed.total_due
             )
             and fixed.due_date = v_candidate
         )
      loop
        v_candidate := v_candidate + 7;
      end loop;

      if v_row.due_date is distinct from v_candidate then
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

create or replace function public.reschedule_scope_installments(
  p_scope text,
  p_branch_id uuid,
  p_samity_id uuid,
  p_from date,
  p_to date
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_samity record;
  v_count integer := 0;
begin
  for v_samity in
    select s.id
    from public.samities s
    where (p_scope = 'organization')
       or (p_scope = 'branch' and s.branch_id = p_branch_id)
       or (p_scope = 'samity' and s.id = p_samity_id)
  loop
    v_count := v_count + public.reschedule_unpaid_samity_installments(
      v_samity.id, p_from, p_to
    );
  end loop;
  return v_count;
end;
$$;

create or replace function public.on_holiday_calendar_reschedule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'INSERT' then
    perform public.reschedule_scope_installments(
      old.scope, old.branch_id, old.samity_id, old.date_from, old.date_to
    );
  end if;
  if tg_op <> 'DELETE' then
    if new.is_active then
      perform public.reschedule_scope_installments(
        new.scope, new.branch_id, new.samity_id, new.date_from, new.date_to
      );
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists holiday_calendar_reschedule_installments on public.holiday_calendar;
create trigger holiday_calendar_reschedule_installments
after insert or update or delete on public.holiday_calendar
for each row execute function public.on_holiday_calendar_reschedule();

create or replace function public.on_samity_closure_reschedule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'INSERT' then
    perform public.reschedule_unpaid_samity_installments(
      old.samity_id, old.closure_date, old.closure_date
    );
  end if;
  if tg_op <> 'DELETE' then
    perform public.reschedule_unpaid_samity_installments(
      new.samity_id, new.closure_date, new.closure_date
    );
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists samity_closure_reschedule_installments on public.samity_week_closures;
create trigger samity_closure_reschedule_installments
after insert or update or delete on public.samity_week_closures
for each row execute function public.on_samity_closure_reschedule();

-- Friday is never a valid weekly meeting day for a samity.
create or replace function public.prevent_friday_samity_meeting()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.meeting_day = 5 then
    raise exception 'SAMITY_FRIDAY_NOT_ALLOWED: শুক্রবার সমিতির সভার দিন হতে পারবে না।';
  end if;
  return new;
end;
$$;

drop trigger if exists samity_friday_meeting_guard on public.samities;
create trigger samity_friday_meeting_guard
before insert or update of meeting_day on public.samities
for each row execute function public.prevent_friday_samity_meeting();

-- The trigger functions run with their owner privileges; direct execution
-- of the internal rescheduler is not exposed to ordinary authenticated users.
revoke all on function public.reschedule_unpaid_samity_installments(uuid,date,date) from public, anon, authenticated;
revoke all on function public.reschedule_scope_installments(text,uuid,uuid,date,date) from public, anon, authenticated;
