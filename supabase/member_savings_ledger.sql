-- Member Savings Ledger hardening.
-- Run after schema.sql, security.sql, member_registration.sql, optional_savings_versions.sql,
-- opening_savings_balances.sql and daily_collection_posting.sql.

-- Savings operators may read member identity within their authorized scope.
drop policy if exists members_read_for_savings on public.members;
create policy members_read_for_savings on public.members
for select to authenticated
using (
  public.can_access_member(id)
  and (
    public.has_module_permission('savings','view')
    or public.has_module_permission('savings','create')
  )
);


-- Savings ledger reads require explicit Savings view/create permission and member scope.
drop policy if exists savings_read_scope on public.savings_transactions;
create policy savings_read_scope on public.savings_transactions
for select to authenticated
using (
  public.can_access_member(member_id)
  and (public.has_module_permission('savings','view') or public.has_module_permission('savings','create'))
);

-- Direct Savings screen entries require the Savings create permission.
drop policy if exists savings_insert_scope on public.savings_transactions;
create policy savings_insert_scope on public.savings_transactions
for insert to authenticated
with check (
  public.can_access_member(member_id)
  and public.has_module_permission('savings','create')
  and created_by = (select auth.uid())
);

-- Serialize transactions per member and savings category so concurrent withdrawals
-- cannot overdraw the same balance.
create or replace function public.validate_savings_transaction_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric(14,2);
  v_lock_key text;
begin
  if new.amount is null or new.amount <= 0 then
    raise exception 'লেনদেনের পরিমাণ শূন্যের বেশি হতে হবে';
  end if;

  if new.savings_category is null or new.savings_category not in ('GS','LTS-New','Optional') then
    raise exception 'সঞ্চয়ের ধরন সঠিক নয়';
  end if;

  if new.savings_category = 'Optional' and not exists (
    select 1 from public.member_savings_enrollments e
    where e.id = new.enrollment_id
      and e.member_id = new.member_id
      and e.savings_type = 'optional'
  ) then
    raise exception 'এই সদস্যের সঠিক Optional Savings স্কিম নির্বাচন করুন';
  end if;

  if new.savings_category <> 'Optional' and new.enrollment_id is not null then
    raise exception 'GS/LTS-New লেনদেনে Optional স্কিম সংযুক্ত করা যাবে না';
  end if;

  if new.savings_type is distinct from case when new.savings_category = 'Optional' then 'optional' else 'mandatory' end then
    raise exception 'সঞ্চয়ের ধরন ও হিসাবের শ্রেণি মিলছে না';
  end if;

  if new.transaction_type not in ('deposit','withdrawal') then
    raise exception 'লেনদেনের ধরন সঠিক নয়';
  end if;
  if new.transaction_date is null or new.transaction_date > current_date then
    raise exception 'ভবিষ্যৎ তারিখে সঞ্চয় লেনদেন করা যাবে না';
  end if;

  if new.transaction_type = 'withdrawal' then
    v_lock_key := new.member_id::text || ':' || new.savings_category;
    perform pg_advisory_xact_lock(hashtextextended(v_lock_key, 0));

    select
      coalesce((
        select case new.savings_category
          when 'GS' then o.gs_balance
          when 'LTS-New' then o.lts_new_balance
          when 'Optional' then o.optional_balance
          else 0 end
        from public.member_savings_opening_balances o
        where o.member_id = new.member_id
          and o.opening_date <= new.transaction_date
      ),0)
      + coalesce(sum(case when t.transaction_type='deposit' then t.amount else -t.amount end),0)
      into v_balance
    from public.savings_transactions t
    where t.member_id = new.member_id
      and t.savings_category = new.savings_category
      and t.transaction_date <= new.transaction_date;

    if new.amount > v_balance then
      raise exception 'বর্তমান সঞ্চয় স্থিতির বেশি উত্তোলন করা যাবে না। বর্তমান স্থিতি: %', v_balance;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists savings_transaction_balance_guard on public.savings_transactions;
create trigger savings_transaction_balance_guard
before insert on public.savings_transactions
for each row execute function public.validate_savings_transaction_balance();

-- Keep a separate immutable audit record for each savings ledger entry.
create or replace function public.audit_savings_transaction_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs(actor_id, action, table_name, record_id, details)
  values (
    coalesce(new.created_by, auth.uid()),
    case when new.transaction_type='deposit' then 'savings_deposit' else 'savings_withdrawal' end,
    'savings_transactions',
    new.id::text,
    jsonb_build_object(
      'member_id', new.member_id,
      'category', new.savings_category,
      'amount', new.amount,
      'transaction_date', new.transaction_date,
      'reference_no', new.reference_no
    )
  );
  return new;
end;
$$;

drop trigger if exists savings_transaction_audit_after_insert on public.savings_transactions;
create trigger savings_transaction_audit_after_insert
after insert on public.savings_transactions
for each row execute function public.audit_savings_transaction_insert();


-- Backward-compatible RPC for clients still using the former Savings screen.
-- New screens write directly to the same protected ledger.
create or replace function public.save_savings_transaction(
  p_member_id uuid,
  p_enrollment_id uuid,
  p_transaction_date date,
  p_transaction_type text,
  p_amount numeric,
  p_reference_no text default null,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enrollment public.member_savings_enrollments%rowtype;
  v_balance numeric(14,2);
  v_category text;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'লগইন প্রয়োজন'; end if;
  if not public.has_module_permission('savings','create') then
    raise exception 'সঞ্চয় লেনদেনের অনুমতি নেই';
  end if;
  if not public.can_access_member(p_member_id) then
    raise exception 'এই সদস্যের তথ্য ব্যবহারের অনুমতি নেই';
  end if;
  if p_transaction_type not in ('deposit','withdrawal') then
    raise exception 'লেনদেনের ধরন সঠিক নয়';
  end if;
  if p_amount is null or p_amount<=0 or round(p_amount,2)<>p_amount then
    raise exception 'সঠিক টাকার পরিমাণ লিখুন';
  end if;
  if p_transaction_date is null or p_transaction_date>current_date then
    raise exception 'ভবিষ্যৎ তারিখে সঞ্চয় লেনদেন করা যাবে না';
  end if;

  select * into v_enrollment
  from public.member_savings_enrollments
  where id=p_enrollment_id and member_id=p_member_id;
  if not found then raise exception 'সদস্যের সঞ্চয় হিসাব নির্বাচন করুন'; end if;

  v_category := case when v_enrollment.savings_type='optional' then 'Optional' else 'GS' end;
  perform pg_advisory_xact_lock(hashtextextended(p_member_id::text || ':' || v_category,0));

  select
    coalesce((
      select case v_category
        when 'GS' then o.gs_balance
        when 'Optional' then o.optional_balance
        else 0 end
      from public.member_savings_opening_balances o
      where o.member_id=p_member_id and o.opening_date<=p_transaction_date
    ),0)
    + coalesce(sum(case when t.transaction_type='deposit' then t.amount else -t.amount end),0)
  into v_balance
  from public.savings_transactions t
  where t.member_id=p_member_id
    and t.savings_category=v_category
    and t.transaction_date<=p_transaction_date;

  if p_transaction_type='withdrawal' and p_amount>v_balance then
    raise exception 'পর্যাপ্ত সঞ্চয় ব্যালেন্স নেই। বর্তমান ব্যালেন্স: %',v_balance;
  end if;

  insert into public.savings_transactions(
    member_id,enrollment_id,savings_type,savings_category,transaction_date,
    transaction_type,amount,reference_no,notes,created_by
  ) values (
    p_member_id,case when v_enrollment.savings_type='optional' then p_enrollment_id else null end,v_enrollment.savings_type,v_category,p_transaction_date,
    p_transaction_type,p_amount,nullif(trim(p_reference_no),''),nullif(trim(p_notes),''),auth.uid()
  ) returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.save_savings_transaction(uuid,uuid,date,text,numeric,text,text) from public;
grant execute on function public.save_savings_transaction(uuid,uuid,date,text,numeric,text,text) to authenticated;
