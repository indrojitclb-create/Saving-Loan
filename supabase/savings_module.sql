-- Savings transactions: member-wise mandatory/optional ledgers with server-side balance checks.
-- Run after schema.sql, security.sql, member_registration.sql and optional_savings_versions.sql.

alter table public.savings_transactions
  add column if not exists savings_type text not null default 'mandatory'
    check (savings_type in ('mandatory','optional')),
  add column if not exists enrollment_id uuid references public.member_savings_enrollments(id) on delete restrict;

create index if not exists savings_transactions_member_date_idx
  on public.savings_transactions(member_id, transaction_date desc, created_at desc);
create index if not exists savings_transactions_enrollment_idx
  on public.savings_transactions(enrollment_id, transaction_date desc);

drop policy if exists savings_read_scope on public.savings_transactions;
create policy savings_read_scope on public.savings_transactions
for select to authenticated
using (
  public.can_access_member(member_id)
  and (
    public.can_manage_module('savings','view')
    or public.can_manage_module('savings','create')
    or public.can_manage_module('collection','view')
  )
);

-- Financial ledger is append-only. Only this RPC can add a new entry.
drop policy if exists savings_insert_scope on public.savings_transactions;

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
set search_path=public
as $savings$
declare
  v_enrollment public.member_savings_enrollments%rowtype;
  v_balance numeric(14,2);
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'লগইন প্রয়োজন'; end if;
  if not public.can_manage_module('savings','create') then
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

  perform pg_advisory_xact_lock(hashtextextended(p_enrollment_id::text,0));

  select coalesce(sum(case when transaction_type='deposit' then amount else -amount end),0)
  into v_balance
  from public.savings_transactions
  where member_id=p_member_id
    and (
      (v_enrollment.savings_type='optional' and enrollment_id=p_enrollment_id)
      or (v_enrollment.savings_type='mandatory' and savings_type='mandatory')
    );

  if p_transaction_type='withdrawal' and p_amount>v_balance then
    raise exception 'পর্যাপ্ত সঞ্চয় ব্যালেন্স নেই। বর্তমান ব্যালেন্স: %',v_balance;
  end if;

  insert into public.savings_transactions(
    member_id,enrollment_id,savings_type,transaction_date,
    transaction_type,amount,reference_no,notes,created_by
  ) values (
    p_member_id,p_enrollment_id,v_enrollment.savings_type,p_transaction_date,
    p_transaction_type,p_amount,nullif(trim(p_reference_no),''),nullif(trim(p_notes),''),auth.uid()
  ) returning id into v_id;

  insert into public.audit_logs(actor_id,action,table_name,record_id,details)
  values(auth.uid(),'CREATE_SAVINGS_TRANSACTION','savings_transactions',v_id::text,
    jsonb_build_object('member_id',p_member_id,'enrollment_id',p_enrollment_id,
      'savings_type',v_enrollment.savings_type,'transaction_type',p_transaction_type,
      'amount',p_amount,'transaction_date',p_transaction_date));

  return v_id;
end;
$savings$;

revoke all on function public.save_savings_transaction(uuid,uuid,date,text,numeric,text,text) from public;
grant execute on function public.save_savings_transaction(uuid,uuid,date,text,numeric,text,text) to authenticated;

alter table public.savings_transactions enable row level security;
