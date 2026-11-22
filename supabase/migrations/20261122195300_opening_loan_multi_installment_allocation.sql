-- Recalculate current opening-loan installment statuses after a collection correction.
-- The underlying transaction history remains auditable; only current schedule statuses are recalculated.
CREATE OR REPLACE FUNCTION public.save_daily_collection(p_samity_id uuid, p_collection_date date, p_rows jsonb, p_action text DEFAULT 'post'::text, p_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 v_sheet public.daily_collection_sheets%rowtype; v_branch uuid; v_role text; v_allowed boolean;
 r jsonb; v_member uuid; v_amt numeric(14,2); v_left numeric(14,2);
 sc record; v_service numeric(14,2); v_principal numeric(14,2); v_loan uuid; v_enroll uuid; v_opening_loan uuid; v_opening_ids uuid[];
 opening_sc record; v_opening_arrears_left numeric(14,2); v_opening_applied numeric(14,2);
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
     v_opening_loan:=nullif(r->>'opening_loan_id','')::uuid;
     if v_opening_loan is not null then
       if not exists(select 1 from public.member_opening_loans where id=v_opening_loan and member_id=v_member and current_status='active') then
         raise exception 'সক্রিয় প্রারম্ভিক ঋণ নির্বাচন করুন'; end if;
     else
       v_loan:=nullif(r->>'loan_id','')::uuid;
       if not exists(select 1 from public.loan_accounts where id=v_loan and member_id=v_member and status='active') then
         raise exception 'সক্রিয় ঋণ নির্বাচন করুন'; end if;
     end if;
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
   if v_sheet.status='posted' and p_action<>'post' then
     raise exception 'পোস্ট করা হিসাব সংশোধন করতে পুনরায় পোস্ট করতে হবে';
   end if;
   if v_sheet.status='posted' and (not v_allowed or nullif(trim(p_reason),'') is null) then
     raise exception 'সংশোধনের অনুমতি ও কারণ আবশ্যক'; end if;
   if v_sheet.status='posted' then
     insert into public.daily_collection_corrections(sheet_id,old_rows,new_rows,reason,corrected_by)
       values(v_sheet.id,v_sheet.rows,p_rows,trim(p_reason),auth.uid());
     update public.member_opening_loans l set
       amount_repaid_to_date=greatest(0,l.amount_repaid_to_date-x.paid),
       overdue_balance=l.overdue_balance+x.arrears,
       updated_by=auth.uid(),updated_at=now()
     from (select opening_loan_id,sum(amount) paid,sum(arrears_applied) arrears
       from public.member_opening_loan_transactions where collection_sheet_id=v_sheet.id group by opening_loan_id) x
     where l.id=x.opening_loan_id;
     select array_agg(distinct x.opening_loan_id) into v_opening_ids
       from (
         select nullif(value->>'opening_loan_id','')::uuid as opening_loan_id
           from jsonb_array_elements(coalesce(v_sheet.rows,'[]'::jsonb))
         union all
         select nullif(value->>'opening_loan_id','')::uuid
           from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb))
       ) x
      where x.opening_loan_id is not null;
     delete from public.member_opening_loan_transactions where collection_sheet_id=v_sheet.id;
     delete from public.savings_transactions where collection_sheet_id=v_sheet.id;
     delete from public.loan_transactions where collection_sheet_id=v_sheet.id;
     update public.member_opening_loan_installment_schedule s
        set status = case
          when coalesce((select sum(t.amount) from public.member_opening_loan_transactions t
                         where t.opening_loan_id=s.opening_loan_id and t.installment_no=s.installment_no),0) >= s.total_due then 'paid'
          when coalesce((select sum(t.amount) from public.member_opening_loan_transactions t
                         where t.opening_loan_id=s.opening_loan_id and t.installment_no=s.installment_no),0) > 0 then 'partial'
          when s.due_date < current_date then 'overdue'
          else 'due' end
      where s.is_current and s.opening_loan_id = any(coalesce(v_opening_ids,'{}'::uuid[]));
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
       -- The shared savings-ledger trigger checks opening balance plus dated ledger
       -- transactions under a per-member/category lock, including concurrent postings.
       insert into public.savings_transactions(member_id,transaction_date,transaction_type,amount,created_by,savings_category,collection_sheet_id)
         values(v_member,p_collection_date,'withdrawal',v_amt,auth.uid(),'GS',v_sheet.id);
     end if;
     v_amt:=coalesce((r->>'lts_new')::numeric,0);
     if v_amt>0 then insert into public.savings_transactions(member_id,transaction_date,transaction_type,amount,created_by,savings_category,collection_sheet_id)
       values(v_member,p_collection_date,'deposit',v_amt,auth.uid(),'LTS-New',v_sheet.id); end if;
     v_amt:=coalesce((r->>'optional_savings')::numeric,0);
     if v_amt>0 then insert into public.savings_transactions(member_id,transaction_date,transaction_type,amount,created_by,savings_category,savings_type,enrollment_id,collection_sheet_id)
       values(v_member,p_collection_date,'deposit',v_amt,auth.uid(),'Optional','optional',nullif(r->>'optional_enrollment_id','')::uuid,v_sheet.id); end if;
     v_left:=coalesce((r->>'loan_paid')::numeric,0);
     if v_left>0 then
       if nullif(r->>'opening_loan_id','') is not null then
         v_opening_loan:=(r->>'opening_loan_id')::uuid;
         select greatest(0,outstanding_balance) into v_amt from public.member_opening_loans
           where id=v_opening_loan and member_id=v_member and current_status='active' for update;
         if v_amt is null or v_left>v_amt then raise exception 'প্রারম্ভিক ঋণের অবশিষ্ট স্থিতির চেয়ে বেশি আদায়'; end if;
         -- Allocate one receipt across installments in due-date order.
         v_opening_arrears_left := (select overdue_balance from public.member_opening_loans where id=v_opening_loan);
         for opening_sc in
           select * from public.member_opening_loan_installment_schedule
            where opening_loan_id=v_opening_loan and is_current and status<>'paid' and due_date<=p_collection_date
            order by due_date, installment_no
            for update
         loop
           exit when v_left<=0;
           v_opening_applied := least(v_left, greatest(0, opening_sc.total_due -
             coalesce((select sum(t.amount) from public.member_opening_loan_transactions t
               where t.opening_loan_id=v_opening_loan and t.installment_no=opening_sc.installment_no),0)));
           if v_opening_applied<=0 then continue; end if;
           insert into public.member_opening_loan_transactions
             (opening_loan_id,transaction_date,amount,arrears_applied,installment_no,created_by,collection_sheet_id)
           values (v_opening_loan,p_collection_date,v_opening_applied,
             least(v_opening_arrears_left,v_opening_applied),opening_sc.installment_no,auth.uid(),v_sheet.id);
           v_opening_arrears_left := greatest(0,v_opening_arrears_left-v_opening_applied);
           v_left := v_left-v_opening_applied;
         end loop;
         if v_left>0 then
           raise exception 'কিস্তির তফসিলে অবশিষ্ট আদায়ের জন্য পর্যাপ্ত কিস্তি নেই';
         end if;
         v_amt := coalesce((select sum(amount) from public.member_opening_loan_transactions
           where collection_sheet_id=v_sheet.id and opening_loan_id=v_opening_loan),0);
         update public.member_opening_loans set
           amount_repaid_to_date=amount_repaid_to_date+v_amt,
           overdue_balance=greatest(0,overdue_balance-(select coalesce(sum(arrears_applied),0)
             from public.member_opening_loan_transactions where collection_sheet_id=v_sheet.id and opening_loan_id=v_opening_loan)),
           next_collectible_balance=greatest(0,outstanding_balance-v_amt-greatest(0,overdue_balance-v_amt)),
           current_status=case when amount_repaid_to_date+v_amt>=principal_amount+service_charge_amount then 'closed' else current_status end,
           updated_by=auth.uid(),updated_at=now()
         where id=v_opening_loan;
         update public.member_opening_loan_installment_schedule s
            set status=case
              when coalesce((select sum(t.amount) from public.member_opening_loan_transactions t
                where t.opening_loan_id=s.opening_loan_id and t.installment_no=s.installment_no),0)>=s.total_due then 'paid'
              when coalesce((select sum(t.amount) from public.member_opening_loan_transactions t
                where t.opening_loan_id=s.opening_loan_id and t.installment_no=s.installment_no),0)>0 then 'partial'
              when s.due_date<p_collection_date then 'overdue' else 'due' end
          where s.opening_loan_id=v_opening_loan and s.is_current;
       else
         v_loan:=nullif(r->>'loan_id','')::uuid;
         for sc in select * from public.loan_installment_schedule where loan_id=v_loan and status<>'paid' and due_date<=p_collection_date
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
     end if;
   end loop;
 end if;
 return v_sheet.id;
end $function$
;

revoke all on function public.save_daily_collection(uuid,date,jsonb,text,text) from public;
revoke all on function public.save_daily_collection(uuid,date,jsonb,text,text) from anon;
grant execute on function public.save_daily_collection(uuid,date,jsonb,text,text) to authenticated;
