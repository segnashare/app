-- Rayons hub Catégories (alignés prod) :
-- Accessoires / Chaussures / Sacs sont des catégories distinctes.
-- Vêtements = tout le vestiaire hors ces trois rayons.

insert into public.item_categories (name, slug, size_scope, sort_order)
select 'Chaussures', 'chaussures', 'shoes', 91
where not exists (select 1 from public.item_categories where slug = 'chaussures');

insert into public.item_categories (name, slug, size_scope, sort_order)
select 'Sacs', 'sacs', 'none', 92
where not exists (select 1 from public.item_categories where slug = 'sacs');

update public.item_categories
set name = 'Chaussures', size_scope = 'shoes', sort_order = 91, updated_at = now()
where slug = 'chaussures';

update public.item_categories
set name = 'Sacs', size_scope = 'none', sort_order = 92, updated_at = now()
where slug = 'sacs';

-- Chaussures : pièces Accessoires avec une taille shoes:*
update public.items i
set item_category_id = ch.id,
    updated_at = now()
from public.item_categories acc,
     public.item_categories ch,
     public.sizes sz
where acc.slug = 'accessoires'
  and ch.slug = 'chaussures'
  and i.item_category_id = acc.id
  and i.item_size_id = sz.id
  and i.deleted_at is null
  and sz.code ilike 'shoes:%';

-- Sacs : pièces Accessoires restantes dont le titre/description parle d’un sac
update public.items i
set item_category_id = s.id,
    updated_at = now()
from public.item_categories acc,
     public.item_categories s
where acc.slug = 'accessoires'
  and s.slug = 'sacs'
  and i.item_category_id = acc.id
  and i.deleted_at is null
  and (
    coalesce(i.title, '') ~* '(^|[^[:alnum:]])(sacs?|pochettes?|besaces?|cabas)([^[:alnum:]]|$)'
    or coalesce(i.description, '') ~* '(^|[^[:alnum:]])(sacs?|pochettes?|besaces?|cabas)([^[:alnum:]]|$)'
  );

create or replace function public.resolve_item_department_slug(p_category_id uuid)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  v_slug text;
begin
  if p_category_id is null then
    return null;
  end if;

  select c.slug into v_slug
  from public.item_categories c
  where c.id = p_category_id;

  if v_slug is null then
    return null;
  end if;

  if v_slug in ('accessoires', 'chaussures', 'sacs') then
    return v_slug;
  end if;

  return 'vetements';
end;
$$;

comment on function public.resolve_item_department_slug(uuid) is
  'Rayon hub : accessoires / chaussures / sacs, sinon vêtements.';
