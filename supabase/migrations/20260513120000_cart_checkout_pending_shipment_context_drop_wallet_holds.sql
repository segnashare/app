-- Panier : statuts métier (checkout_pending, confirmed), plus de wallet_holds.
-- Expéditions : contexte (panier aller/retour, intake/outtake) et cart_id nullable.
-- (RPC reserve / expire / release / wallet_available : fichier suivant 20260513120100 — évite 42601 sur push distant.)

-- 1) shipment_context + shipments
do $body$
begin
  create type public.shipment_context as enum (
    'cart_outbound',
    'cart_return',
    'member_intake',
    'member_outtake',
    'other'
  );
exception
  when duplicate_object then null;
end $body$;

alter table public.shipments
  add column if not exists context public.shipment_context not null default 'cart_outbound';

alter table public.shipments
  alter column cart_id drop not null;

alter table public.shipments drop constraint if exists shipments_cart_context_check;
alter table public.shipments
  add constraint shipments_cart_context_check check (
    (context in ('cart_outbound', 'cart_return') and cart_id is not null)
    or (context not in ('cart_outbound', 'cart_return'))
  );

comment on column public.shipments.context is
  'Nature du colis : aller/retour panier (cart_id requis), ou flux intake/outtake membre (cart_id optionnel).';

-- 2) cart_items : statuts ligne pour contrôle / cycle (sans toucher items.status reserved)
-- Compare via status::text pour que ça reste valide si la colonne est déjà typée en enum
-- `cart_item_status` (bases où une migration ultérieure a été appliquée hors ordre).
alter table public.cart_items drop constraint if exists cart_items_status_check;
alter table public.cart_items add constraint cart_items_status_check check (
  status::text = any (
    array[
      'in_cart',
      'reserved',
      'archived',
      'reservation_pending',
      'verification_pending',
      'verified',
      'rejected',
      'needs_cleaning'
    ]::text[]
  )
);

comment on column public.cart_items.status is
  'Ligne panier : réservation (reserved/reservation_pending), cycle retour/contrôle (verification_pending, verified, rejected, needs_cleaning), archived.';

-- 3) Enum panier : remplace reserved -> checkout_pending, returned -> confirmed
do $body$
begin
  create type public.cart_status_new as enum (
    'active',
    'checkout_pending',
    'confirmed',
    'archived',
    'canceled'
  );
exception
  when duplicate_object then null;
end $body$;

alter table public.carts
  alter column status drop default;

alter table public.carts
  alter column status type public.cart_status_new
  using (
    case status::text
      when 'active' then 'active'::public.cart_status_new
      when 'reserved' then 'checkout_pending'::public.cart_status_new
      when 'returned' then 'confirmed'::public.cart_status_new
      when 'archived' then 'archived'::public.cart_status_new
      when 'canceled' then 'canceled'::public.cart_status_new
      else 'active'::public.cart_status_new
    end
  );

alter table public.carts
  alter column status set default 'active'::public.cart_status_new;

alter table public.cart_status_history
  alter column from_status type public.cart_status_new
  using (
    case
      when from_status is null then null::public.cart_status_new
      when from_status::text = 'active' then 'active'::public.cart_status_new
      when from_status::text = 'reserved' then 'checkout_pending'::public.cart_status_new
      when from_status::text = 'returned' then 'confirmed'::public.cart_status_new
      when from_status::text = 'archived' then 'archived'::public.cart_status_new
      when from_status::text = 'canceled' then 'canceled'::public.cart_status_new
      else null::public.cart_status_new
    end
  );

alter table public.cart_status_history
  alter column to_status type public.cart_status_new
  using (
    case to_status::text
      when 'active' then 'active'::public.cart_status_new
      when 'reserved' then 'checkout_pending'::public.cart_status_new
      when 'returned' then 'confirmed'::public.cart_status_new
      when 'archived' then 'archived'::public.cart_status_new
      when 'canceled' then 'canceled'::public.cart_status_new
      else 'active'::public.cart_status_new
    end
  );

drop type public.cart_status;

alter type public.cart_status_new rename to cart_status;

comment on type public.cart_status is
  'active=brouillon ; checkout_pending=réservation + page paiement (locked_until) ; confirmed=payé, logistique ; archived=cycle clos (lignes vérifiées) ; canceled=annulé.';

-- 4) wallet_holds (cascade : table peut déjà être absente sur certaines bases)
drop table if exists public.wallet_holds cascade;

-- 5) Concurrence paniers
create or replace function public.get_cart_items_competition_state(p_item_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $fn$
  with uid as (
    select auth.uid() as viewer_id
  ),
  ids as (
    select distinct x as item_id
    from unnest(coalesce(p_item_ids, array[]::uuid[])) as t(x)
    where x is not null
  ),
  agg as (
    select
      i.item_id,
      (
        select count(*)::int
        from public.cart_items ci
        join public.carts c on c.id = ci.cart_id
        cross join uid u
        where ci.item_id = i.item_id
          and ci.deleted_at is null
          and ci.status = 'in_cart'
          and c.deleted_at is null
          and c.user_id is distinct from u.viewer_id
          and c.status in ('active'::public.cart_status, 'checkout_pending'::public.cart_status)
      ) as other_shoppers_in_cart,
      coalesce(
        (
          select
            (coalesce(it.status::text, '') = 'reserved'
             and not exists (
               select 1
               from public.cart_items ci2
               join public.carts c2 on c2.id = ci2.cart_id
               cross join uid u2
               where ci2.item_id = i.item_id
                 and ci2.deleted_at is null
                 and ci2.status = 'reserved'
                 and c2.user_id = u2.viewer_id
             ))
          from public.items it
          where it.id = i.item_id
            and it.deleted_at is null
        ),
        false
      ) as reserved_by_other,
      (
        select max(sub.t)
        from (
          select c.locked_until as t
          from public.cart_items ci
          join public.carts c on c.id = ci.cart_id
          cross join uid u
          where ci.item_id = i.item_id
            and ci.deleted_at is null
            and ci.status = 'reserved'
            and c.deleted_at is null
            and c.user_id is distinct from u.viewer_id
            and c.status = 'checkout_pending'::public.cart_status
            and c.locked_until is not null
        ) sub
        where sub.t is not null
      ) as reserved_until_at
    from ids i
    cross join uid u0
    where u0.viewer_id is not null
  )
  select coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'item_id', a.item_id,
          'other_shoppers_in_cart', a.other_shoppers_in_cart,
          'reserved_by_other', a.reserved_by_other,
          'reserved_until_at', a.reserved_until_at
        )
        order by a.item_id
      )
      from agg a
    ),
    '[]'::jsonb
  );
$fn$;

revoke all on function public.get_cart_items_competition_state(uuid[]) from public;
grant execute on function public.get_cart_items_competition_state(uuid[]) to authenticated;
