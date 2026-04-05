-- Comptes internes @segnashare.com : rôle organization (prêteuses boutique, etc.).
insert into public.user_roles (user_id, role)
select u.id, 'organization'::public.app_role
from public.users u
where u.deleted_at is null
  and u.email is not null
  and lower(u.email) like '%@segnashare.com'
on conflict (user_id, role) do update
set
  deleted_at = null,
  updated_at = now();

-- Exclure aussi par email si le rôle n’est pas encore renseigné.
create or replace function public.get_shop_featured_lenders(p_limit integer default 9)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_limit integer;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 9), 24));

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'user_id', x.user_id,
          'display_name', up.display_name,
          'city', up.city,
          'item_count', x.cnt,
          'photos', up.photos
        )
        order by x.cnt desc, x.last_item_at desc nulls last
      )
      from (
        select
          i.owner_user_id as user_id,
          count(*)::integer as cnt,
          max(i.updated_at) as last_item_at
        from public.items i
        inner join public.users u on u.id = i.owner_user_id
        where i.deleted_at is null
          and i.owner_user_id is distinct from v_uid
          and u.status is distinct from 'corporate_inventory'::public.user_status
          and (u.email is null or lower(u.email) not like '%@segnashare.com')
          and not exists (
            select 1
            from public.user_roles ur
            where ur.user_id = i.owner_user_id
              and ur.role = 'organization'::public.app_role
              and ur.deleted_at is null
          )
          and i.status in (
            'listed'::public.item_status,
            'available'::public.item_status,
            'in_cart'::public.item_status,
            'reserved'::public.item_status
          )
        group by i.owner_user_id
        order by count(*) desc, max(i.updated_at) desc
        limit v_limit
      ) x
      inner join public.user_profiles up
        on up.user_id = x.user_id
        and up.deleted_at is null
    ),
    '[]'::jsonb
  );
end;
$$;

comment on function public.get_shop_featured_lenders(integer) is
  'Boutique : prêteuses (pièces au catalogue), hors soi, hors corporate, hors rôle organization, hors @segnashare.com.';
