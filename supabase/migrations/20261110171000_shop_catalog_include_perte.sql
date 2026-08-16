-- Shop : inclure `perte` (affichage type sold) dans les RPC catalogue.

do $$
declare
  r record;
  def text;
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

    if position('''perte''::public.item_status' in def) = 0
       and position('''sold''::public.item_status' in def) > 0 then
      -- Ajoute perte juste après sold dans les filtres IN (même pattern que include_sold).
      def := replace(
        def,
        '''sold''::public.item_status',
        '''sold''::public.item_status,' || e'\n        ''perte''::public.item_status'
      );
      -- Le replace touche aussi le CASE de tri : on le corrige.
      def := replace(
        def,
        'when i.status = ''sold''::public.item_status,' || e'\n        ''perte''::public.item_status then 1 else 0 end',
        'when i.status in (''sold''::public.item_status, ''perte''::public.item_status) then 1 else 0 end'
      );
    end if;

    if position('when i.status in (''sold''::public.item_status, ''perte''::public.item_status) then 1 else 0 end' in def) = 0
       and position('when i.status = ''sold''::public.item_status then 1 else 0 end' in def) > 0 then
      def := replace(
        def,
        'when i.status = ''sold''::public.item_status then 1 else 0 end',
        'when i.status in (''sold''::public.item_status, ''perte''::public.item_status) then 1 else 0 end'
      );
    end if;

    if def is distinct from pg_get_functiondef(r.oid) then
      execute def;
    end if;
  end loop;
end $$;
