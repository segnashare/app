create table if not exists public.cms_app_ad_placements (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  placement_key text not null,
  title text not null,
  image_url text not null,
  target_url text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz
);

create index if not exists idx_cms_app_ad_placements_active
  on public.cms_app_ad_placements (placement_key, is_active, sort_order, created_at);

drop trigger if exists trg_cms_app_ad_placements_updated_at on public.cms_app_ad_placements;
create trigger trg_cms_app_ad_placements_updated_at
before update on public.cms_app_ad_placements
for each row execute function public.set_updated_at();

alter table public.cms_app_ad_placements enable row level security;

drop policy if exists "cms_app_ad_placements_select_authenticated" on public.cms_app_ad_placements;
create policy "cms_app_ad_placements_select_authenticated"
on public.cms_app_ad_placements
for select
to authenticated
using (
  is_active = true
  and (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at >= now())
);

grant select on public.cms_app_ad_placements to authenticated;
