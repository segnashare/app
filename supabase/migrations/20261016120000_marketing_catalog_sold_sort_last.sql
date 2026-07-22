-- Catalogue marketing : sold toujours en fin de liste (après tri prix / nouveautés).

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
      and p.proname = 'get_marketing_website_catalog_items_page'
  loop
    def := pg_get_functiondef(r.oid);
    if position('when i.status = ''sold''::public.item_status then 1 else 0 end' in def) > 0 then
      continue;
    end if;
    new_def := regexp_replace(
      def,
      'order by[[:space:]]+case when v_sort = ''price_asc''',
      E'order by\n      case when i.status = ''sold''::public.item_status then 1 else 0 end asc,\n      case when v_sort = ''price_asc''',
      'i'
    );
    if new_def is distinct from def then
      execute new_def;
    end if;
  end loop;
end $$;
