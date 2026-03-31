-- Agrégats cross-panier (RLS cart_items limitée au propriétaire) : concurrents in_cart + réservation ailleurs.

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
          and c.status in ('active'::public.cart_status, 'reserved'::public.cart_status)
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
      ) as reserved_by_other
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
          'reserved_by_other', a.reserved_by_other
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
