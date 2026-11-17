-- User ID login migration for Saving & Loan.
-- Safe first step: keeps existing Supabase email/password accounts intact.
-- Run this once in Supabase SQL Editor before deploying the new User ID login code.

alter table public.profiles
  add column if not exists login_id text;

create unique index if not exists profiles_login_id_unique
  on public.profiles (lower(login_id))
  where login_id is not null and btrim(login_id) <> '';

comment on column public.profiles.login_id is
  'Unique user-facing login ID assigned by an authorized administrator. Email remains internal to Supabase Auth.';
