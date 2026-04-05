-- Hub catalogue : config de section (titre, flèche, lien) + frames référence (pièce, catégorie, marque).

alter table public.cms_app_sections
  add column if not exists draft_section_config jsonb not null default '{}'::jsonb;

alter table public.cms_app_sections
  add column if not exists published_section_config jsonb;

alter table public.cms_app_section_frames
  drop constraint if exists cms_app_section_frames_type_check;

alter table public.cms_app_section_frames
  add constraint cms_app_section_frames_type_check check (
    frame_type in (
      'offer_card',
      'category_capsule',
      'promo_ad',
      'editorial_card',
      'shop_item_ref',
      'shop_category_ref',
      'shop_brand_ref'
    )
  );

-- ---------------------------------------------------------------------------
-- RPC : config publiée + frames (même filtre plan que get_cms_section_frames)
-- ---------------------------------------------------------------------------

create or replace function public.get_cms_catalog_section(p_section_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_plan text;
  v_key text;
  v_section_id uuid;
  v_config jsonb;
  v_frames jsonb;
begin
  v_plan := public.get_effective_plan_code_for_cms();
  v_key := nullif(trim(coalesce(p_section_key, '')), '');
  if v_key is null then
    raise exception 'section_key requis';
  end if;

  select s.id, coalesce(s.published_section_config, '{}'::jsonb)
    into v_section_id, v_config
  from public.cms_app_sections s
  where s.section_key = v_key
  limit 1;

  if v_section_id is null then
    return jsonb_build_object(
      'config', '{}'::jsonb,
      'frames', '[]'::jsonb
    );
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', f.id,
        'frame_type', f.frame_type,
        'sort_order', f.sort_order,
        'plan_code', f.plan_code,
        'payload', f.published_payload
      )
      order by f.sort_order asc, f.created_at asc
    ),
    '[]'::jsonb
  )
  into v_frames
  from public.cms_app_section_frames f
  where f.section_id = v_section_id
    and f.plan_code = v_plan
    and f.published_payload is not null
    and jsonb_typeof(f.published_payload) = 'object';

  return jsonb_build_object(
    'config', coalesce(v_config, '{}'::jsonb),
    'frames', coalesce(v_frames, '[]'::jsonb)
  );
end;
$$;

grant execute on function public.get_cms_catalog_section(text) to authenticated;

comment on function public.get_cms_catalog_section(text) is
  'Retourne { config, frames } pour une section hub catalogue (config publiée + frames du plan effectif).';

-- ---------------------------------------------------------------------------
-- Seed sections hub (idempotent)
-- ---------------------------------------------------------------------------

insert into public.cms_app_sections (
  section_key,
  display_title,
  sort_order,
  draft_section_config,
  published_section_config
)
values
  (
    'shop_section_discover',
    'Hub — À découvrir sur Segna',
    45,
    '{"title":"À découvrir sur Segna","show_more_arrow":true,"more_href":"/shop/discover"}'::jsonb,
    '{"title":"À découvrir sur Segna","show_more_arrow":true,"more_href":"/shop/discover"}'::jsonb
  ),
  (
    'shop_section_categories',
    'Hub — Catégories',
    46,
    '{"title":"Catégories","show_more_arrow":false,"more_href":""}'::jsonb,
    '{"title":"Catégories","show_more_arrow":false,"more_href":""}'::jsonb
  ),
  (
    'shop_section_preferred_brands',
    'Hub — Vos marques préférées',
    47,
    '{"title":"Vos marques préférées","show_more_arrow":true,"more_href":"/shop/preferred-brands"}'::jsonb,
    '{"title":"Vos marques préférées","show_more_arrow":true,"more_href":"/shop/preferred-brands"}'::jsonb
  ),
  (
    'shop_section_deals',
    'Hub — Les bons coups',
    48,
    '{"title":"Les bons coups","show_more_arrow":true,"more_href":"/shop/deals"}'::jsonb,
    '{"title":"Les bons coups","show_more_arrow":true,"more_href":"/shop/deals"}'::jsonb
  ),
  (
    'shop_section_french',
    'Hub — Mode à la française',
    49,
    '{"title":"Mode à la française","show_more_arrow":true,"more_href":"/shop/french"}'::jsonb,
    '{"title":"Mode à la française","show_more_arrow":true,"more_href":"/shop/french"}'::jsonb
  )
on conflict (section_key) do update
set
  display_title = excluded.display_title,
  sort_order = excluded.sort_order;
