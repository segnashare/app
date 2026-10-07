-- Pièce d’archive / créateur (flag item) + suppression de la catégorie Archivistes.

alter table public.items
  add column if not exists is_archive boolean not null default false;

comment on column public.items.is_archive is
  'Pièce d’archive / créateur. Indépendant de la catégorie ; pastille catalogue.';

do $$
declare
  v_archivistes uuid;
  v_accessoires uuid;
begin
  select id into v_archivistes from public.item_categories where slug = 'archivistes' limit 1;
  select id into v_accessoires from public.item_categories where slug = 'accessoires' limit 1;
  if v_archivistes is not null then
    if v_accessoires is not null then
      update public.items
        set item_category_id = v_accessoires, updated_at = now()
        where item_category_id = v_archivistes;
    else
      update public.items
        set item_category_id = null, updated_at = now()
        where item_category_id = v_archivistes;
    end if;
    delete from public.item_categories where id = v_archivistes;
  end if;
end $$;

-- Expose is_archive dans les payloads catalogue shop / marketing.
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
        'get_marketing_website_catalog_items_page'
      )
  loop
    def := pg_get_functiondef(r.oid);
    if position('is_archive' in def) > 0 then
      continue;
    end if;

    new_def := replace(
      def,
      'i.item_materiaux_id,',
      'i.item_materiaux_id,' || chr(10) || '      i.is_archive,'
    );
    new_def := replace(
      new_def,
      '''condition_score'', s.condition_score',
      '''condition_score'', s.condition_score,' || chr(10) || '        ''is_archive'', coalesce(s.is_archive, false)'
    );

    if new_def is distinct from def then
      execute new_def;
    end if;
  end loop;
end $$;
