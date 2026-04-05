-- Frames : plusieurs segments par ligne (plan_codes[]) ; section : visible_plan_codes dans la config publiée.

-- ---------------------------------------------------------------------------
-- Colonne plan_codes + synchro plan_code (référence « primaire » pour index / compat)
-- ---------------------------------------------------------------------------

alter table public.cms_app_section_frames
  add column if not exists plan_codes text[];

update public.cms_app_section_frames
set plan_codes = array[plan_code]::text[]
where plan_codes is null;

alter table public.cms_app_section_frames
  alter column plan_codes set not null;

alter table public.cms_app_section_frames
  drop constraint if exists cms_app_section_frames_plan_codes_check;

alter table public.cms_app_section_frames
  add constraint cms_app_section_frames_plan_codes_check check (
    cardinality(plan_codes) >= 1
    and plan_codes <@ array['guest', 'segna_plus', 'segna_x']::text[]
  );

create or replace function public.cms_app_section_frames_sync_plan_code()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.plan_codes is null or cardinality(new.plan_codes) < 1 then
    raise exception 'plan_codes must be a non-empty subset of guest, segna_plus, segna_x';
  end if;
  if 'guest' = any (new.plan_codes) then
    new.plan_code := 'guest';
  elsif 'segna_plus' = any (new.plan_codes) then
    new.plan_code := 'segna_plus';
  else
    new.plan_code := 'segna_x';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_cms_app_section_frames_sync_plan_code on public.cms_app_section_frames;
create trigger trg_cms_app_section_frames_sync_plan_code
before insert or update of plan_codes on public.cms_app_section_frames
for each row execute function public.cms_app_section_frames_sync_plan_code();

-- Réordonnancement global par section (plus par plan)
drop index if exists public.idx_cms_app_section_frames_section_plan_sort;
create index if not exists idx_cms_app_section_frames_section_sort
  on public.cms_app_section_frames (section_id, sort_order asc, id asc);

-- ---------------------------------------------------------------------------
-- Helpers : section visible pour le plan courant ?
-- ---------------------------------------------------------------------------

create or replace function public.cms_section_visible_for_plan(p_config jsonb, p_plan text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    when p_config is null then true
    when not (p_config ? 'visible_plan_codes') then true
    when jsonb_typeof(p_config->'visible_plan_codes') <> 'array' then true
    when jsonb_array_length(p_config->'visible_plan_codes') = 0 then true
    else coalesce((p_config->'visible_plan_codes') @> to_jsonb(p_plan), false)
  end;
$$;

-- ---------------------------------------------------------------------------
-- RPC boutique : ordre filtré par segment
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
      select jsonb_agg(s.section_key order by s.page_sort_order asc, s.section_key asc)
      from public.cms_app_sections s
      where s.page_key = 'boutique'
        and public.cms_section_visible_for_plan(coalesce(s.published_section_config, '{}'::jsonb), v_plan)
    ),
    '[]'::jsonb
  );
end;
$$;

grant execute on function public.get_cms_boutique_section_order() to authenticated;

comment on function public.get_cms_boutique_section_order() is
  'Liste ordonnée des section_key boutique visibles pour le plan effectif (visible_plan_codes dans config publiée ; vide = tous).';

-- ---------------------------------------------------------------------------
-- get_cms_catalog_section : section + frames filtrés par plan_codes[]
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
    and v_plan = any (f.plan_codes)
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
  'Config publiée + frames : section filtrée par visible_plan_codes ; frames par plan_codes[] (repli guest).';

-- ---------------------------------------------------------------------------
-- get_cms_section_frames (capsules accueil boutique, etc.)
-- ---------------------------------------------------------------------------

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
    and v_plan = any (f.plan_codes)
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
  'Frames publiées : section visible pour le plan ; frames par plan_codes[] (repli guest).';
