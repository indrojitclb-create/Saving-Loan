-- Optional Savings opening details.
-- Additive and safe to run on the existing opening-balance table.
-- Does not delete, rewrite, or reset existing member balances.

alter table public.member_savings_opening_balances
  add column if not exists optional_opening_date date,
  add column if not exists optional_monthly_installment_amount numeric(14,2) not null default 0,
  add column if not exists optional_installments_paid integer not null default 0;

alter table public.member_savings_opening_balances
  drop constraint if exists member_savings_opening_optional_monthly_check,
  drop constraint if exists member_savings_opening_optional_installments_check;

alter table public.member_savings_opening_balances
  add constraint member_savings_opening_optional_monthly_check
    check (optional_monthly_installment_amount >= 0),
  add constraint member_savings_opening_optional_installments_check
    check (optional_installments_paid >= 0);

comment on column public.member_savings_opening_balances.optional_opening_date
  is 'Opening date for the member Optional Savings balance';
comment on column public.member_savings_opening_balances.optional_monthly_installment_amount
  is 'Monthly Optional Savings installment amount at opening';
comment on column public.member_savings_opening_balances.optional_installments_paid
  is 'Number of Optional Savings installments paid before system opening';
