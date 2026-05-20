-- Boutique : inclure `sizes.code` dans les facettes tailles (haut / bas / chaussures).

create or replace function public.get_shop_boutique_filter_facets()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_categories jsonb;
  v_sizes jsonb;
  v_brands jsonb;
  v_colors jsonb;
  v_materials jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb)
  into v_categories
  from (
    select id, name, parent_category_id
    from public.item_categories
    order by name asc nulls last
  ) q;

  select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb)
  into v_sizes
  from (
    select id, label, code
    from public.sizes
    order by code asc nulls last
  ) q;

  select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb)
  into v_brands
  from (
    select id, label
    from public.item_brands
    order by label asc nulls last
  ) q;

  select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb)
  into v_colors
  from (
    select id, label
    from public.item_couleurs
    order by label asc nulls last
  ) q;

  select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb)
  into v_materials
  from (
    select id, label
    from public.item_materiaux
    order by label asc nulls last
  ) q;

  return jsonb_build_object(
    'categories', v_categories,
    'sizes', v_sizes,
    'brands', v_brands,
    'colors', v_colors,
    'materials', v_materials
  );
end;
$$;
