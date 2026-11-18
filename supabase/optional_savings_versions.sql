-- Versioned Optional Savings Schemes
-- Existing member enrollments keep their original snapshots. New versions apply only to future enrollments.

create table if not exists public.optional_savings_product_versions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.optional_savings_products(id) on delete restrict,
  version_no integer not null check (version_no > 0),
  installment_amount numeric(14,2) not null check (
    installment_amount between 100 and 2000
    and mod(installment_amount,100)=0
  ),
  term_months integer not null check (term_months > 0),
  interest_rate numeric(7,4) check (interest_rate is null or interest_rate >= 0),
  effective_from date not null,
  conditions jsonb not null default '{}'::jsonb,
  rules_file_name text,
  rules_storage_path text,
  rules_file_type text,
  rules_file_size bigint,
  calculation_method text,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(product_id, version_no),
  unique(product_id, effective_from)
);

create index if not exists optional_savings_versions_product_effective_idx
  on public.optional_savings_product_versions(product_id, effective_from desc);

alter table public.member_savings_enrollments
  add column if not exists product_version_id uuid references public.optional_savings_product_versions(id) on delete restrict,
  add column if not exists version_no_snapshot integer,
  add column if not exists interest_rate_snapshot numeric(7,4),
  add column if not exists conditions_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists scheme_effective_from_snapshot date;

-- Preserve the old product terms for historical enrollments. Do not invent an old interest rate.
update public.member_savings_enrollments e
set version_no_snapshot = coalesce(version_no_snapshot, 1),
    conditions_snapshot = coalesce(conditions_snapshot, '{}'::jsonb)
where e.savings_type = 'optional';

alter table public.optional_savings_product_versions enable row level security;

drop policy if exists optional_savings_versions_read on public.optional_savings_product_versions;
create policy optional_savings_versions_read
on public.optional_savings_product_versions for select to authenticated
using (
  public.can_manage_module('optional_savings','view')
  or public.can_manage_module('optional_savings','create')
  or public.can_manage_module('optional_savings','update')
  or public.can_manage_module('members','view')
  or public.can_manage_module('members','create')
);

drop policy if exists optional_savings_versions_insert on public.optional_savings_product_versions;
create policy optional_savings_versions_insert
on public.optional_savings_product_versions for insert to authenticated
with check (
  (public.can_manage_module('optional_savings','create') or public.can_manage_module('optional_savings','update'))
  and created_by = (select auth.uid())
);

-- A published version is immutable: changes must be recorded as a new version.
drop policy if exists optional_savings_versions_update on public.optional_savings_product_versions;
create policy optional_savings_versions_update
on public.optional_savings_product_versions for update to authenticated
using (
  public.can_manage_module('optional_savings','update')
  and not exists (
    select 1 from public.member_savings_enrollments e
    where e.product_version_id = optional_savings_product_versions.id
  )
)
with check (
  public.can_manage_module('optional_savings','update')
);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values (
  'scheme-rules',
  'scheme-rules',
  false,
  20971520,
  array[
    'application/pdf',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do nothing;

drop policy if exists scheme_rules_read on storage.objects;
create policy scheme_rules_read on storage.objects for select to authenticated
using (
  bucket_id = 'scheme-rules'
  and (
    public.can_manage_module('optional_savings','view')
    or public.can_manage_module('optional_savings','create')
    or public.can_manage_module('optional_savings','update')
    or public.can_manage_module('members','view')
    or public.can_manage_module('members','create')
  )
);

drop policy if exists scheme_rules_insert on storage.objects;
create policy scheme_rules_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'scheme-rules'
  and (public.can_manage_module('optional_savings','create') or public.can_manage_module('optional_savings','update'))
);

drop policy if exists scheme_rules_delete on storage.objects;
create policy scheme_rules_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'scheme-rules'
  and public.can_manage_module('optional_savings','update')
);
