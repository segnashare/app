-- Doublons Vinted sous Vêtements : feuille isolée vs dossier (ex. Veste / Vestes).
-- On bascule les pièces (et les mannequins IA) puis on retire la feuille.
do $$
declare
  rec record;
  leaf_id uuid;
  folder_id uuid;
begin
  for rec in
    select *
    from (values
      ('Veste', 'Vêtements', 'Vestes', 'Manteaux et vestes'),
      ('Manteau', 'Vêtements', 'Manteaux', 'Manteaux et vestes'),
      ('Haut', 'Vêtements', 'Hauts et t-shirts', 'Vêtements'),
      ('Pantalon', 'Vêtements', 'Pantalons et leggings', 'Vêtements')
    ) as t(leaf_name, leaf_parent, folder_name, folder_parent)
  loop
    leaf_id := null;
    folder_id := null;

    select c.id
      into leaf_id
    from public.item_categories c
    join public.item_categories p on p.id = c.parent_category_id
    where c.name = rec.leaf_name
      and p.name = rec.leaf_parent
      and not exists (
        select 1 from public.item_categories ch where ch.parent_category_id = c.id
      )
    limit 1;

    select c.id
      into folder_id
    from public.item_categories c
    join public.item_categories p on p.id = c.parent_category_id
    where c.name = rec.folder_name
      and p.name = rec.folder_parent
    limit 1;

    if leaf_id is null or folder_id is null then
      continue;
    end if;

    update public.items
    set item_category_id = folder_id,
        updated_at = now()
    where item_category_id = leaf_id;

    if to_regclass('public.ai_fashion_model_categories') is not null then
      insert into public.ai_fashion_model_categories (model_id, category_id)
      select model_id, folder_id
      from public.ai_fashion_model_categories
      where category_id = leaf_id
      on conflict (model_id, category_id) do nothing;

      delete from public.ai_fashion_model_categories
      where category_id = leaf_id;
    end if;

    delete from public.item_categories
    where id = leaf_id;
  end loop;
end $$;
