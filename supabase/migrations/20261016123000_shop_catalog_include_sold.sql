-- Shop app : inclure `sold` dans les RPC catalogue (+ sold en fin de liste pour get_shop_catalog_items).

do $$
declare
  r record;
  def text;
  new_def text;
begin
  for r in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'get_shop_catalog_items',
        'get_shop_catalog_items_by_ids',
        'get_shop_catalog_excluding_user_favorites',
        'get_shop_most_liked_items',
        'get_shop_most_liked_fraction',
        'get_shop_user_favorite_items'
      )
  loop
    def := pg_get_functiondef(r.oid);
    if position('''sold''::public.item_status' in def) = 0
       and position('''reserved''::public.item_status' in def) > 0 then
      new_def := replace(
        def,
        '''reserved''::public.item_status',
        '''reserved''::public.item_status,' || e'\n        ''sold''::public.item_status'
      );
      def := new_def;
    end if;

    -- Tri : sold toujours après les autres (hub / recherche catalogue)
    if r.proname = 'get_shop_catalog_items'
       and position('when i.status = ''sold''::public.item_status then 1 else 0 end' in def) = 0
       and position('order by i.updated_at desc' in def) > 0 then
      def := replace(
        def,
        'order by i.updated_at desc',
        E'order by\n      case when i.status = ''sold''::public.item_status then 1 else 0 end asc,\n      i.updated_at desc'
      );
    end if;

    if def is distinct from pg_get_functiondef(r.oid) then
      execute def;
    end if;
  end loop;
end $$;
