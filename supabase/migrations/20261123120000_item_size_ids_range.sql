-- Ranges de tailles (sélection continue) + libellés lettres seuls.

alter table public.items
  add column if not exists item_size_ids uuid[] not null default '{}'::uuid[];

alter table public.items
  add column if not exists item_size_range_key text;

comment on column public.items.item_size_ids is
  'Tailles couvertes par la pièce (intervalle continu). item_size_id = première.';

comment on column public.items.item_size_range_key is
  'Libellé compact pour l’affichage, ex. XS/S/M ou L.';

update public.items
set
  item_size_ids = array[item_size_id],
  updated_at = now()
where item_size_id is not null
  and (item_size_ids is null or cardinality(item_size_ids) = 0);

-- Libellés vêtements : lettre seule (plus de FR/US).
update public.sizes set label = 'XXXS' where code in ('top:XXXS', 'bottom:30');
update public.sizes set label = 'XXS' where code in ('top:XXS', 'bottom:32');
update public.sizes set label = 'XS' where code in ('top:XS', 'bottom:34');
update public.sizes set label = 'S' where code in ('top:S', 'bottom:36');
update public.sizes set label = 'M' where code in ('top:M', 'bottom:38');
update public.sizes set label = 'L' where code in ('top:L', 'bottom:40');
update public.sizes set label = 'XL' where code in ('top:XL', 'bottom:42');
update public.sizes set label = 'XXL' where code in ('top:XXL', 'bottom:44');
update public.sizes set label = 'XXXL' where code in ('top:XXXL', 'bottom:46');
update public.sizes set label = '4XL' where code in ('top:4XL', 'bottom:48');
update public.sizes set label = '5XL' where code in ('top:5XL', 'bottom:50');
update public.sizes set label = '6XL' where code in ('top:6XL', 'bottom:52');

update public.items i
set item_size_range_key = s.label
from public.sizes s
where i.item_size_id = s.id
  and nullif(trim(i.item_size_range_key), '') is null
  and nullif(trim(s.label), '') is not null
  and s.label is distinct from 'Taille unique';

-- Payload catalogue : size_label = range key si présent ; item_size_ids exposé.
do $$
declare
  r record;
  def text;
  new_def text;
begin
  for r in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'get_shop_catalog_items',
        'get_shop_catalog_items_by_ids',
        'get_shop_catalog_excluding_user_favorites',
        'get_shop_most_liked_items',
        'get_shop_most_liked_fraction',
        'get_shop_user_favorite_items',
        'get_shop_newest_fraction',
        'get_shop_catalog_items_by_tag_page_slug',
        'get_marketing_website_catalog_items',
        'get_marketing_website_catalog_items_by_ids',
        'get_marketing_website_catalog_items_page',
        'get_marketing_website_catalog_facets_scoped'
      )
  loop
    def := pg_get_functiondef(r.oid);
    new_def := def;

    if position('item_size_range_key' in new_def) = 0 then
      new_def := replace(
        new_def,
        'sz.label as size_label',
        'coalesce(nullif(trim(i.item_size_range_key), ''''), sz.label) as size_label'
      );
    end if;

    if position('''item_size_ids''' in new_def) = 0
       and position('''item_size_id''' in new_def) > 0 then
      new_def := replace(
        new_def,
        '''item_size_id'', s.item_size_id,',
        '''item_size_id'', s.item_size_id,' || chr(10) || '        ''item_size_ids'', coalesce(s.item_size_ids, ''{}''::uuid[]),'
      );
    end if;

    if position('i.item_size_ids,' in new_def) = 0 then
      new_def := replace(
        new_def,
        'i.item_size_id,',
        'i.item_size_id,' || chr(10) || '      i.item_size_ids,' || chr(10) || '      i.item_size_range_key,'
      );
    end if;

    -- Filtre marketing : overlap sur le range.
    new_def := replace(
      new_def,
      'i.item_size_id = any(p_size_ids)',
      '(i.item_size_id = any(p_size_ids) or coalesce(i.item_size_ids, ''{}''::uuid[]) && p_size_ids)'
    );
    new_def := replace(
      new_def,
      'e.item_size_id = any(p_size_ids)',
      '(e.item_size_id = any(p_size_ids) or coalesce(e.item_size_ids, ''{}''::uuid[]) && p_size_ids)'
    );

    if new_def is distinct from def then
      execute new_def;
    end if;
  end loop;
end $$;
