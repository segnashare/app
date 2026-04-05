-- Frames catalogue : inclure toute frame qui cible le plan courant OU qui inclut « guest »
-- dans plan_codes. Sinon, une frame publiée avec seulement guest était invisible pour S+/X,
-- et le repli guest ne s’appliquait que lorsque la première requête renvoyait 0 ligne au total
-- (une seule frame « bien » taguée masquait les autres).

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

  if not public.cms_section_visible_for_plan(v_config, v_plan) then
    return jsonb_build_object(
      'config', coalesce(v_config, '{}'::jsonb),
      'frames', '[]'::jsonb
    );
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', f.id,
        'frame_type', f.frame_type,
        'sort_order', f.sort_order,
        'plan_code', v_plan,
        'payload', f.published_payload
      )
      order by f.sort_order asc, f.created_at asc
    ),
    '[]'::jsonb
  )
  into v_frames
  from public.cms_app_section_frames f
  where f.section_id = v_section_id
    and (
      v_plan = any (f.plan_codes)
      or 'guest' = any (f.plan_codes)
    )
    and f.published_payload is not null
    and jsonb_typeof(f.published_payload) = 'object';

  if coalesce(jsonb_array_length(v_frames), 0) = 0 and v_plan is distinct from 'guest' then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', f.id,
          'frame_type', f.frame_type,
          'sort_order', f.sort_order,
          'plan_code', v_plan,
          'payload', f.published_payload
        )
        order by f.sort_order asc, f.created_at asc
      ),
      '[]'::jsonb
    )
    into v_frames
    from public.cms_app_section_frames f
    where f.section_id = v_section_id
      and 'guest' = any (f.plan_codes)
      and f.published_payload is not null
      and jsonb_typeof(f.published_payload) = 'object';
  end if;

  return jsonb_build_object(
    'config', coalesce(v_config, '{}'::jsonb),
    'frames', coalesce(v_frames, '[]'::jsonb)
  );
end;
$$;

comment on function public.get_cms_catalog_section(text) is
  'Config publiée + frames : section par visible_plan_codes ; frames si plan effectif ∈ plan_codes OU guest ∈ plan_codes (repli guest si vide).';

create or replace function public.get_cms_section_frames(p_section_key text)
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
  v_rows jsonb;
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
    return '[]'::jsonb;
  end if;

  if not public.cms_section_visible_for_plan(v_config, v_plan) then
    return '[]'::jsonb;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', f.id,
        'frame_type', f.frame_type,
        'sort_order', f.sort_order,
        'plan_code', v_plan,
        'payload', f.published_payload
      )
      order by f.sort_order asc, f.created_at asc
    ),
    '[]'::jsonb
  )
  into v_rows
  from public.cms_app_section_frames f
  where f.section_id = v_section_id
    and (
      v_plan = any (f.plan_codes)
      or 'guest' = any (f.plan_codes)
    )
    and f.published_payload is not null
    and jsonb_typeof(f.published_payload) = 'object';

  if coalesce(jsonb_array_length(v_rows), 0) = 0 and v_plan is distinct from 'guest' then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', f.id,
          'frame_type', f.frame_type,
          'sort_order', f.sort_order,
          'plan_code', v_plan,
          'payload', f.published_payload
        )
        order by f.sort_order asc, f.created_at asc
      ),
      '[]'::jsonb
    )
    into v_rows
    from public.cms_app_section_frames f
    where f.section_id = v_section_id
      and 'guest' = any (f.plan_codes)
      and f.published_payload is not null
      and jsonb_typeof(f.published_payload) = 'object';
  end if;

  return coalesce(v_rows, '[]'::jsonb);
end;
$$;

comment on function public.get_cms_section_frames(text) is
  'Frames publiées : section visible pour le plan ; frames si plan ∈ plan_codes OU guest ∈ plan_codes (repli guest si vide).';
