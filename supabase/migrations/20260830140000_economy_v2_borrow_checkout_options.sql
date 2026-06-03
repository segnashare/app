-- Durées d'emprunt au checkout + tarif €/crédit manquant (configurable BO).
-- Defaults économie v2 : Guest 100 crédits, Segna X 500.

create table if not exists public.billing_borrow_checkout_options (
  duration_days integer primary key check (duration_days >= 1 and duration_days <= 90),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  label text,
  cents_per_missing_credit integer not null check (cents_per_missing_credit >= 0),
  sort_order smallint not null default 0,
  is_active boolean not null default true
);

comment on table public.billing_borrow_checkout_options is
  'Durées d''emprunt proposées au checkout et tarif en centimes d''euro par crédit manquant (complément cash).';

drop trigger if exists trg_billing_borrow_checkout_options_updated_at on public.billing_borrow_checkout_options;
create trigger trg_billing_borrow_checkout_options_updated_at
before update on public.billing_borrow_checkout_options
for each row execute function public.set_updated_at();

insert into public.billing_borrow_checkout_options (duration_days, label, cents_per_missing_credit, sort_order, is_active)
values
  (7, '7 jours', 10, 1, true),
  (14, '14 jours', 15, 2, true),
  (30, '1 mois', 20, 3, true)
on conflict (duration_days) do nothing;

alter table public.billing_borrow_checkout_options enable row level security;

drop policy if exists billing_borrow_checkout_options_select_authenticated on public.billing_borrow_checkout_options;
create policy billing_borrow_checkout_options_select_authenticated
  on public.billing_borrow_checkout_options
  for select
  to authenticated
  using (is_active = true);

create or replace function public.billing_borrow_checkout_options_active()
returns table (
  duration_days integer,
  label text,
  cents_per_missing_credit integer,
  sort_order smallint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    o.duration_days,
    coalesce(nullif(trim(o.label), ''), o.duration_days::text || ' j'),
    o.cents_per_missing_credit,
    o.sort_order
  from public.billing_borrow_checkout_options o
  where o.is_active = true
  order by o.sort_order asc, o.duration_days asc;
$$;

comment on function public.billing_borrow_checkout_options_active() is
  'Options durée emprunt actives pour checkout app (lecture membres authentifiés via RPC).';

revoke all on function public.billing_borrow_checkout_options_active() from public;
grant execute on function public.billing_borrow_checkout_options_active() to authenticated;

-- Plafonds économie v2 (Guest 100, Segna X 500 ; Segna+ archivé côté BO).
update public.billing_plan_entitlement_limits
set monthly_consumption_points_grant = 100
where plan_code = 'guest';

update public.billing_plan_entitlement_limits
set monthly_consumption_points_grant = 500
where plan_code = 'segna_x';

update public.billing_plan_entitlement_limits
set is_active = false
where plan_code = 'segna_plus';
