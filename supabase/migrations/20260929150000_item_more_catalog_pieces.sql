-- Fiche item : section « Mais encore… » — pièces disponibles, taille membre en premier.

create or replace function public.get_item_more_catalog_pieces_v1(
  p_item_id uuid,
  p_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_limit integer;
  v_ids uuid[];
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 20), 20));

  select coalesce(array_agg(s.id order by s.size_rank asc, s.updated_at desc), '{}'::uuid[])
  into v_ids
  from (
    select
      i.id,
      case
        when public.item_size_matches_member_profile(i.item_size_id, v_uid) then 0
        else 1
      end as size_rank,
      i.updated_at
    from public.items i
    where i.deleted_at is null
      and i.id <> p_item_id
      and i.owner_user_id <> v_uid
      and i.status in (
        'available'::public.item_status,
        'in_cart'::public.item_status
      )
      and not exists (
        select 1
        from public.users u
        where u.id = i.owner_user_id
          and u.status = 'corporate_inventory'::public.user_status
      )
      and not exists (
        select 1
        from public.users u2
        where u2.id = i.owner_user_id
          and coalesce(u2.phantom_mode, false)
      )
    order by size_rank asc, i.updated_at desc
    limit v_limit
  ) s;

  return public.get_shop_catalog_items_by_ids(v_ids);
end;
$$;

grant execute on function public.get_item_more_catalog_pieces_v1(uuid, integer) to authenticated;

comment on function public.get_item_more_catalog_pieces_v1(uuid, integer) is
  'Fiche item : jusqu’à 20 pièces disponibles (taille membre / taille unique d’abord).';
