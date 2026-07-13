-- Fix get_shop_catalog_items_by_tag_page_slug: get_shop_catalog_items_by_ids returns jsonb, not a row with .items

create or replace function public.get_shop_catalog_items_by_tag_page_slug(
  p_page_slug text,
  p_limit integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_tag_id uuid;
  v_limit integer;
  v_items jsonb;
  v_item_ids uuid[];
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'Not authenticated'; end if;

  v_limit := greatest(1, least(coalesce(p_limit, 120), 200));

  select t.id into v_tag_id
  from public.tags t
  where t.is_active = true
    and t.page_kind = 'shop'
    and t.page_slug = trim(p_page_slug)
  limit 1;

  if v_tag_id is null then
    return jsonb_build_object('tag', null, 'items', '[]'::jsonb);
  end if;

  select coalesce(
    array_agg(it.item_id order by it.sort_order, it.item_id),
    array[]::uuid[]
  )
  into v_item_ids
  from public.item_tags it
  join public.items i on i.id = it.item_id and i.deleted_at is null
  where it.tag_id = v_tag_id;

  if cardinality(v_item_ids) = 0 then
    v_items := '[]'::jsonb;
  else
    v_items := coalesce(
      public.get_shop_catalog_items_by_ids(v_item_ids) -> 'items',
      '[]'::jsonb
    );
  end if;

  return jsonb_build_object(
    'tag', public.get_catalog_tag_page_v1('shop', trim(p_page_slug)),
    'items', coalesce(v_items, '[]'::jsonb)
  );
end;
$$;
