-- Débogage « Catégories » boutique : exécuter dans Supabase SQL Editor (rôle service_role ou lecture tables).
-- L’app appelle la RPC get_cms_catalog_section('shop_section_categories') avec TON JWT (plan effectif).

-- 1) Frames publiées côté base (indépendant du plan)
select
  f.id,
  f.sort_order,
  f.frame_type,
  f.plan_codes,
  f.plan_code,
  (f.published_payload is not null) as has_published_payload,
  (f.published_at is not null) as has_published_at,
  f.published_payload ->> 'title' as pub_title,
  f.published_payload ->> 'target_url' as pub_target_url
from public.cms_app_section_frames f
join public.cms_app_sections s on s.id = f.section_id
where s.section_key = 'shop_section_categories'
order by f.sort_order asc, f.created_at asc;

-- 2) Corps de la RPC (chercher « guest » = any (f.plan_codes) ou or 'guest' = any)
select p.prosrc like '%guest%=%any%plan_codes%' as body_mentions_guest_any_plan_codes
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'get_cms_catalog_section'
  and pg_get_function_identity_arguments(p.oid) = 'p_section_key text';
