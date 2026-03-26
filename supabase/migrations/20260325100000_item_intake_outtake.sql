-- Parcours d'entrée (annonce / modération / membre) hors statut catalogue & panier.
-- Parcours de sortie (retours / clôture) sans mélanger avec in_cart / reserved.
-- Les colonnes public.items.status restent inchangées pour cette migration (compat code existant).
-- Cible documentée pour items.status : draft | draft_deleted | listed | in_cart | reserved | retired | archived
--   (listed ~= available aujourd'hui ; migration enum à planifier séparément).

-- Listing / admission pipeline
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'item_intake_listing_stage') then
    create type public.item_intake_listing_stage as enum (
      'draft',
      'evaluation',
      'evaluated',
      'validation_pending',
      'validated',
      'refused'
    );
  end if;
end $$;

-- Physique après validation métier annonce (optionnel)
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'item_intake_fulfillment_stage') then
    create type public.item_intake_fulfillment_stage as enum (
      'shipped_in',
      'verification_pending',
      'verified'
    );
  end if;
end $$;

-- Retours / sortie de la relation membre (compléter avec shipments au besoin)
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'item_outtake_stage') then
    create type public.item_outtake_stage as enum (
      'none',
      'return_open',
      'in_transit',
      'logistics_received',
      'settled'
    );
  end if;
end $$;

create table if not exists public.item_intake (
  item_id uuid not null primary key references public.items (id) on delete cascade,
  listing_stage public.item_intake_listing_stage not null default 'draft',
  fulfillment_stage public.item_intake_fulfillment_stage null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.item_intake is
  'Pipeline d''entrée annonce (brouillon → modération → membre). Ne remplace pas items.status (panier / résa) tant que la bascule code n''est pas faite.';

comment on column public.item_intake.listing_stage is
  'evaluation=file modération back ; evaluated=OK back ; validation_pending=attente validation prix membre ; validated=prêt côté process annonce.';

comment on column public.item_intake.fulfillment_stage is
  'Optionnel : expédition vers hub puis contrôle physique avant collection.';

create index if not exists item_intake_listing_stage_idx on public.item_intake (listing_stage);
create index if not exists item_intake_fulfillment_stage_idx on public.item_intake (fulfillment_stage)
  where fulfillment_stage is not null;

drop trigger if exists item_intake_set_updated_at on public.item_intake;
create trigger item_intake_set_updated_at
before update on public.item_intake
for each row execute function public.set_updated_at();

create table if not exists public.item_outtake (
  item_id uuid not null primary key references public.items (id) on delete cascade,
  stage public.item_outtake_stage not null default 'none',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.item_outtake is
  'Pipeline de sortie / retour membre → logistique. À croiser avec shipments et shipment_return_status.';

drop trigger if exists item_outtake_set_updated_at on public.item_outtake;
create trigger item_outtake_set_updated_at
before update on public.item_outtake
for each row execute function public.set_updated_at();

-- Backfill intake depuis items.status (mapping legacy → sémantique nouveau pipeline)
insert into public.item_intake (item_id, listing_stage, fulfillment_stage, metadata)
select
  i.id,
  case i.status::text
    when 'draft' then 'draft'::public.item_intake_listing_stage
    when 'draft_deleted' then 'draft'::public.item_intake_listing_stage
    when 'validation_pending' then 'evaluation'::public.item_intake_listing_stage
    when 'valuation' then 'validation_pending'::public.item_intake_listing_stage
    when 'available' then 'validated'::public.item_intake_listing_stage
    when 'in_cart' then 'validated'::public.item_intake_listing_stage
    when 'reserved' then 'validated'::public.item_intake_listing_stage
    when 'retired' then 'validated'::public.item_intake_listing_stage
    when 'archived' then 'validated'::public.item_intake_listing_stage
    else 'validated'::public.item_intake_listing_stage
  end,
  null::public.item_intake_fulfillment_stage,
  case
    when i.status::text = 'draft_deleted' then jsonb_build_object('legacy_items_status', 'draft_deleted')
    else '{}'::jsonb
  end
from public.items i
on conflict (item_id) do nothing;

-- Nouvelles lignes items : garantir une ligne intake
create or replace function public.items_after_insert_ensure_item_intake()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.item_intake (item_id, listing_stage, metadata)
  values (
    new.id,
    case new.status::text
      when 'draft' then 'draft'::public.item_intake_listing_stage
      when 'draft_deleted' then 'draft'::public.item_intake_listing_stage
      when 'validation_pending' then 'evaluation'::public.item_intake_listing_stage
      when 'valuation' then 'validation_pending'::public.item_intake_listing_stage
      else 'validated'::public.item_intake_listing_stage
    end,
    case
      when new.status::text = 'draft_deleted' then jsonb_build_object('legacy_items_status', 'draft_deleted')
      else '{}'::jsonb
    end
  )
  on conflict (item_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_items_after_insert_item_intake on public.items;
create trigger trg_items_after_insert_item_intake
after insert on public.items
for each row execute function public.items_after_insert_ensure_item_intake();

alter table public.item_intake enable row level security;
alter table public.item_outtake enable row level security;

drop policy if exists "item_intake_select_own" on public.item_intake;
create policy "item_intake_select_own"
on public.item_intake
for select
to authenticated
using (
  exists (
    select 1
    from public.items x
    where x.id = item_intake.item_id
      and x.owner_user_id = (select auth.uid())
      and x.deleted_at is null
  )
);

drop policy if exists "item_outtake_select_own" on public.item_outtake;
create policy "item_outtake_select_own"
on public.item_outtake
for select
to authenticated
using (
  exists (
    select 1
    from public.items x
    where x.id = item_outtake.item_id
      and x.owner_user_id = (select auth.uid())
      and x.deleted_at is null
  )
);

comment on column public.items.status is
  'Disponibilité commerce / cycle panier. Pipeline annonce & physique : public.item_intake (entrée) et public.item_outtake (sortie). Cible simplification enum : draft, draft_deleted, listed, in_cart, reserved, retired, archived.';
