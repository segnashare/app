-- Retrait d’une section par page : soft-delete sur la liaison ; dernière page active → soft-delete la section.

alter table public.cms_app_section_on_page
  add column if not exists deleted_at timestamptz null;

comment on column public.cms_app_section_on_page.deleted_at is
  'Si non null : la section n’apparaît plus sur cette page (les autres placements restent actifs).';

alter table public.cms_app_sections
  add column if not exists deleted_at timestamptz null;

comment on column public.cms_app_sections.deleted_at is
  'Si non null : section archivée (plus affichée dans l’app ni listée dans le BO) ; les frames restent en base.';

create index if not exists idx_cms_app_section_on_page_active_sort
  on public.cms_app_section_on_page (page_key, page_sort_order)
  where deleted_at is null;

create index if not exists idx_cms_app_sections_active_key
  on public.cms_app_sections (section_key)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- RPC : ignorer liaisons et sections soft-supprimées
-- ---------------------------------------------------------------------------

create or replace function public.get_cms_boutique_section_order()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_plan text;
begin
  v_plan := public.get_effective_plan_code_for_cms();
  return coalesce(
    (
      select jsonb_agg(s.section_key order by p.page_sort_order asc, s.section_key asc)
      from public.cms_app_section_on_page p
      join public.cms_app_sections s on s.id = p.section_id
      where p.page_key = 'boutique'
        and p.deleted_at is null
        and s.deleted_at is null
        and public.cms_section_visible_for_plan(coalesce(s.published_section_config, '{}'::jsonb), v_plan)
    ),
    '[]'::jsonb
  );
end;
$$;

grant execute on function public.get_cms_boutique_section_order() to authenticated;

comment on function public.get_cms_boutique_section_order() is
  'Ordre boutique : placements actifs (deleted_at null) et sections non archivées.';

create or replace function public.get_cms_section_published_config(p_section_key text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(s.published_section_config, '{}'::jsonb)
  from public.cms_app_sections s
  where s.section_key = nullif(trim(coalesce(p_section_key, '')), '')
    and s.deleted_at is null
  limit 1;
$$;

grant execute on function public.get_cms_section_published_config(text) to authenticated;
grant execute on function public.get_cms_section_published_config(text) to anon;

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
    and s.deleted_at is null
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

grant execute on function public.get_cms_catalog_section(text) to authenticated;

comment on function public.get_cms_catalog_section(text) is
  'Config + frames : section non archivée (deleted_at null).';

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
    and s.deleted_at is null
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

grant execute on function public.get_cms_section_frames(text) to authenticated;

comment on function public.get_cms_section_frames(text) is
  'Frames publiées : section non archivée (deleted_at null).';
