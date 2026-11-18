-- Member registration wizard, optional savings setup, and document metadata.
-- Safe to run more than once.
alter table public.members
  add column if not exists samity_id uuid references public.samities(id) on delete restrict,
  add column if not exists member_surname text,
  add column if not exists primary_product text,
  add column if not exists gender text,
  add column if not exists is_third_gender boolean not null default false,
  add column if not exists date_of_birth date,
  add column if not exists father_name text,
  add column if not exists mother_name text,
  add column if not exists marital_status text,
  add column if not exists admission_fee numeric(14,2) not null default 0,
  add column if not exists admission_no text,
  add column if not exists application_no text,
  add column if not exists education_level text,
  add column if not exists nationality text not null default 'Bangladesh',
  add column if not exists smart_id text,
  add column if not exists national_id text,
  add column if not exists birth_registration_no text,
  add column if not exists tin_no text,
  add column if not exists other_card_type text,
  add column if not exists other_card_no text,
  add column if not exists present_division_id uuid references public.area_divisions(id),
  add column if not exists present_district_id uuid references public.area_districts(id),
  add column if not exists present_upazila_id uuid references public.area_upazilas(id),
  add column if not exists present_village_id uuid references public.area_villages(id),
  add column if not exists present_post_office_id uuid references public.area_post_offices(id),
  add column if not exists present_union text,
  add column if not exists present_house_street text,
  add column if not exists family_contact_no text,
  add column if not exists permanent_same_as_present boolean not null default false,
  add column if not exists permanent_division_id uuid references public.area_divisions(id),
  add column if not exists permanent_district_id uuid references public.area_districts(id),
  add column if not exists permanent_upazila_id uuid references public.area_upazilas(id),
  add column if not exists permanent_village_id uuid references public.area_villages(id),
  add column if not exists permanent_post_office_id uuid references public.area_post_offices(id),
  add column if not exists permanent_union text,
  add column if not exists permanent_house_street text,
  add column if not exists permanent_contact_no text,
  add column if not exists member_type text not null default 'General',
  add column if not exists profession text,
  add column if not exists religion text,
  add column if not exists remarks text,
  add column if not exists family_member_count integer,
  add column if not exists yearly_income numeric(14,2),
  add column if not exists land_area numeric(14,4),
  add column if not exists land_area_unit text not null default 'Acre',
  add column if not exists other_note text,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists members_samity_idx on public.members(samity_id);
create index if not exists members_branch_idx on public.members(branch_id);
create unique index if not exists members_smart_id_unique on public.members(smart_id) where nullif(smart_id,'') is not null;
create unique index if not exists members_national_id_unique on public.members(national_id) where nullif(national_id,'') is not null;

-- Optional savings schemes are managed separately from member registration.
create table if not exists public.optional_savings_products (
  id uuid primary key default gen_random_uuid(),
  product_name text not null unique,
  installment_amount numeric(14,2) not null check(installment_amount > 0),
  term_months integer not null check(term_months > 0),
  description text,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.member_savings_enrollments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete restrict,
  savings_type text not null check(savings_type in ('mandatory','optional')),
  product_id uuid references public.optional_savings_products(id) on delete restrict,
  amount numeric(14,2) not null check(amount >= 0),
  term_months integer,
  product_name_snapshot text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check ((savings_type='mandatory' and product_id is null) or (savings_type='optional' and product_id is not null))
);
create index if not exists member_savings_member_idx on public.member_savings_enrollments(member_id);

create table if not exists public.member_documents (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  document_type text not null check(document_type in ('member_picture','member_signature','member_nid','admission_form','loan_proposal','contact','kyc','trade_license')),
  file_name text not null,
  storage_path text not null unique,
  content_type text,
  file_size bigint not null default 0,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists member_documents_member_idx on public.member_documents(member_id);

-- Generate the member number inside the database so concurrent registrations cannot collide.
create or replace function public.assign_member_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch_code text;
  v_samity_code text;
  v_prefix text;
  v_next integer;
begin
  if new.samity_id is null then
    raise exception 'সমিতি নির্বাচন করতে হবে';
  end if;

  select b.branch_code, s.samity_code, s.branch_id
    into v_branch_code, v_samity_code, new.branch_id
  from public.samities s
  join public.branches b on b.id=s.branch_id
  where s.id=new.samity_id and s.status='active' and b.is_active=true;

  if v_branch_code is null or v_samity_code is null then
    raise exception 'নির্বাচিত সমিতি বা Branch সক্রিয় নয়';
  end if;

  v_prefix := lpad(v_branch_code,3,'0') || '-' || lpad(v_samity_code,3,'0');
  perform pg_advisory_xact_lock(hashtextextended(v_prefix,0));

  select coalesce(max(nullif(regexp_replace(member_code, '^.*-', ''), '')::integer),0)+1
    into v_next
  from public.members
  where member_code like v_prefix || '-%';

  new.member_code := v_prefix || '-' || lpad(v_next::text,4,'0');
  return new;
end;
$$;

drop trigger if exists members_assign_code_before_insert on public.members;
create trigger members_assign_code_before_insert
before insert on public.members
for each row execute function public.assign_member_code();

-- RLS policies use the existing module permission helper.
alter table public.optional_savings_products enable row level security;
alter table public.member_savings_enrollments enable row level security;
alter table public.member_documents enable row level security;

drop policy if exists members_read_permission on public.members;
create policy members_read_permission on public.members for select to authenticated
using (public.can_manage_module('members','view') or public.can_manage_module('members','create') or public.can_manage_module('members','update'));
drop policy if exists members_insert_permission on public.members;
create policy members_insert_permission on public.members for insert to authenticated
with check (public.can_manage_module('members','create') and created_by=(select auth.uid()));
drop policy if exists members_update_permission on public.members;
create policy members_update_permission on public.members for update to authenticated
using (public.can_manage_module('members','update')) with check (public.can_manage_module('members','update'));

drop policy if exists optional_savings_products_read on public.optional_savings_products;
create policy optional_savings_products_read on public.optional_savings_products for select to authenticated
using (public.can_manage_module('optional_savings','view') or public.can_manage_module('optional_savings','create') or public.can_manage_module('members','view') or public.can_manage_module('members','create'));
drop policy if exists optional_savings_products_manage on public.optional_savings_products;
create policy optional_savings_products_manage on public.optional_savings_products for all to authenticated
using (public.can_manage_module('optional_savings','create') or public.can_manage_module('optional_savings','update'))
with check (public.can_manage_module('optional_savings','create') or public.can_manage_module('optional_savings','update'));

drop policy if exists member_savings_read on public.member_savings_enrollments;
create policy member_savings_read on public.member_savings_enrollments for select to authenticated
using (public.can_manage_module('members','view') or public.can_manage_module('members','create') or public.can_manage_module('savings','view'));
drop policy if exists member_savings_insert on public.member_savings_enrollments;
create policy member_savings_insert on public.member_savings_enrollments for insert to authenticated
with check ((public.can_manage_module('members','create') or public.can_manage_module('savings','create')) and created_by=(select auth.uid()));

drop policy if exists member_documents_read on public.member_documents;
create policy member_documents_read on public.member_documents for select to authenticated
using (public.can_manage_module('members','view') or public.can_manage_module('members','create') or public.can_manage_module('members','update'));
drop policy if exists member_documents_insert on public.member_documents;
create policy member_documents_insert on public.member_documents for insert to authenticated
with check (public.can_manage_module('members','create') and uploaded_by=(select auth.uid()));
drop policy if exists member_documents_delete on public.member_documents;
create policy member_documents_delete on public.member_documents for delete to authenticated
using (public.can_manage_module('members','delete'));

-- Private bucket for member files. Files are not publicly readable.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('member-documents','member-documents',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;

drop policy if exists member_documents_storage_read on storage.objects;
create policy member_documents_storage_read on storage.objects for select to authenticated
using (bucket_id='member-documents' and (public.can_manage_module('members','view') or public.can_manage_module('members','create') or public.can_manage_module('members','update')));
drop policy if exists member_documents_storage_insert on storage.objects;
create policy member_documents_storage_insert on storage.objects for insert to authenticated
with check (bucket_id='member-documents' and public.can_manage_module('members','create'));
drop policy if exists member_documents_storage_delete on storage.objects;
create policy member_documents_storage_delete on storage.objects for delete to authenticated
using (bucket_id='member-documents' and public.can_manage_module('members','delete'));

-- Extend permission editor's available module keys.
