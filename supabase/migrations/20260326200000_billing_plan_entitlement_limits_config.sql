-- Plafonds par plan (Guest / Segna+ / Segna X) : source éditable ; billing_plan_limits() lit cette table.

create table if not exists public.billing_plan_entitlement_limits (
  plan_code text primary key check (plan_code in ('guest', 'segna_plus', 'segna_x')),
  included_orders_limit integer not null default 0 check (included_orders_limit >= 0),
  included_points_limit bigint not null default 0 check (included_points_limit >= 0),
  included_lends_limit integer not null default 0 check (included_lends_limit >= 0),
  updated_at timestamptz not null default now()
);

comment on table public.billing_plan_entitlement_limits is
  'Plafonds commandes / points / prêts par plan. Modifiable depuis le back-office ; billing_plan_limits() et billing_upsert_monthly_entitlement s''appuient dessus.';

drop trigger if exists trg_billing_plan_entitlement_limits_updated_at on public.billing_plan_entitlement_limits;
create trigger trg_billing_plan_entitlement_limits_updated_at
before update on public.billing_plan_entitlement_limits
for each row execute function public.set_updated_at();

insert into public.billing_plan_entitlement_limits (plan_code, included_orders_limit, included_points_limit, included_lends_limit)
values
  ('guest', 0, 0, 0),
  ('segna_plus', 1, 100, 5),
  ('segna_x', 2, 500, 10)
on conflict (plan_code) do nothing;

alter table public.billing_plan_entitlement_limits enable row level security;

-- billing_plan_limits : lecture table (fallback 0 si ligne absente).
drop function if exists public.billing_plan_limits(text);

create or replace function public.billing_plan_limits(p_plan_code text)
returns table (included_orders_limit integer, included_points_limit bigint, included_lends_limit integer)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(
      (select e.included_orders_limit from public.billing_plan_entitlement_limits e where e.plan_code = p_plan_code limit 1),
      0
    ),
    coalesce(
      (select e.included_points_limit from public.billing_plan_entitlement_limits e where e.plan_code = p_plan_code limit 1),
      0::bigint
    ),
    coalesce(
      (select e.included_lends_limit from public.billing_plan_entitlement_limits e where e.plan_code = p_plan_code limit 1),
      0
    );
$$;

grant execute on function public.billing_plan_limits(text) to authenticated;
