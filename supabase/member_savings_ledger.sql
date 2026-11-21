-- Member Savings Ledger hardening.
-- Run after schema.sql, security.sql, member_registration.sql and daily_collection_posting.sql.

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
    where e.member_id = new.member_id and e.savings_type = 'optional'
  ) then
    raise exception 'এই সদস্য Optional Savings-এ অন্তর্ভুক্ত নন';
  end if;

  if new.transaction_type not in ('deposit','withdrawal') then
    raise exception 'লেনদেনের ধরন সঠিক নয়';
  end if;

  if new.transaction_type = 'withdrawal' then
    v_lock_key := new.member_id::text || ':' || new.savings_category;
    perform pg_advisory_xact_lock(hashtextextended(v_lock_key, 0));

    select coalesce(sum(case when t.transaction_type='deposit' then t.amount else -t.amount end),0)
      into v_balance
    from public.savings_transactions t
    where t.member_id = new.member_id
      and t.savings_category = new.savings_category;

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
