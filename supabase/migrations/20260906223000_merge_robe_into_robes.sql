-- Doublon catalogue : « Robe » (feuille) vs « Robes » (dossier). On bascule les pièces puis on retire « Robe ».
do $$
declare
  robe_id uuid;
  robes_id uuid;
begin
  select c.id
    into robe_id
  from public.item_categories c
  join public.item_categories p on p.id = c.parent_category_id
  where c.name = 'Robe'
    and p.name = 'Vêtements'
    and not exists (
      select 1 from public.item_categories ch where ch.parent_category_id = c.id
    )
  limit 1;

  select c.id
    into robes_id
  from public.item_categories c
  join public.item_categories p on p.id = c.parent_category_id
  where c.name = 'Robes'
    and p.name = 'Vêtements'
  limit 1;

  if robe_id is null or robes_id is null then
    return;
  end if;

  update public.items
  set item_category_id = robes_id,
      updated_at = now()
  where item_category_id = robe_id;

  if to_regclass('public.ai_fashion_model_categories') is not null then
    insert into public.ai_fashion_model_categories (model_id, category_id)
    select model_id, robes_id
    from public.ai_fashion_model_categories
    where category_id = robe_id
    on conflict (model_id, category_id) do nothing;

    delete from public.ai_fashion_model_categories
    where category_id = robe_id;
  end if;

  delete from public.item_categories
  where id = robe_id;
end $$;
