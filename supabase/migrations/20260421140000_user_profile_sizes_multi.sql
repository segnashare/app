-- Permettre plusieurs tailles par catégorie (haut / bas / chaussures) et adapter le RPC.

alter table public.user_profile_sizes
  drop constraint if exists user_profile_sizes_user_profile_id_category_key;

alter table public.user_profile_sizes
  add constraint user_profile_sizes_user_profile_id_category_size_id_key
  unique (user_profile_id, category, size_id);

drop function if exists public.set_user_profile_sizes(text, text, text, uuid);

create or replace function public.set_user_profile_sizes(
  p_top_size_codes text[],
  p_bottom_size_codes text[],
  p_shoes_size_codes text[],
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_user_profile_id uuid;
  v_top_clean text[];
  v_bottom_clean text[];
  v_shoes_clean text[];
  r text;
  v_size_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select coalesce(array_agg(distinct trim(x)) filter (where length(trim(x)) > 0), '{}')
  into v_top_clean
  from unnest(coalesce(p_top_size_codes, '{}')) as u(x);

  select coalesce(array_agg(distinct trim(x)) filter (where length(trim(x)) > 0), '{}')
  into v_bottom_clean
  from unnest(coalesce(p_bottom_size_codes, '{}')) as u(x);

  select coalesce(array_agg(distinct trim(x)) filter (where length(trim(x)) > 0), '{}')
  into v_shoes_clean
  from unnest(coalesce(p_shoes_size_codes, '{}')) as u(x);

  if coalesce(array_length(v_top_clean, 1), 0) < 1
     or coalesce(array_length(v_bottom_clean, 1), 0) < 1
     or coalesce(array_length(v_shoes_clean, 1), 0) < 1 then
    raise exception 'Choisis au moins une taille pour le haut, le bas et les chaussures.';
  end if;

  insert into public.user_profiles (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  select id
  into v_user_profile_id
  from public.user_profiles
  where user_id = v_uid;

  delete from public.user_profile_sizes
  where user_profile_id = v_user_profile_id
    and category in ('top', 'bottom', 'shoes');

  foreach r in array v_top_clean loop
    select id into v_size_id
    from public.sizes
    where code = r
    limit 1;
    if v_size_id is null then
      raise exception 'Unknown top size code: %', r;
    end if;
    insert into public.user_profile_sizes (user_profile_id, category, size_id)
    values (v_user_profile_id, 'top', v_size_id);
  end loop;

  foreach r in array v_bottom_clean loop
    select id into v_size_id
    from public.sizes
    where code = r
    limit 1;
    if v_size_id is null then
      raise exception 'Unknown bottom size code: %', r;
    end if;
    insert into public.user_profile_sizes (user_profile_id, category, size_id)
    values (v_user_profile_id, 'bottom', v_size_id);
  end loop;

  foreach r in array v_shoes_clean loop
    select id into v_size_id
    from public.sizes
    where code = r
    limit 1;
    if v_size_id is null then
      raise exception 'Unknown shoes size code: %', r;
    end if;
    insert into public.user_profile_sizes (user_profile_id, category, size_id)
    values (v_user_profile_id, 'shoes', v_size_id);
  end loop;

  perform public.log_activity_event(
    p_event_name => 'set_user_profile_sizes',
    p_payload => jsonb_build_object(
      'top_size_codes', to_jsonb(v_top_clean),
      'bottom_size_codes', to_jsonb(v_bottom_clean),
      'shoes_size_codes', to_jsonb(v_shoes_clean)
    ),
    p_request_id => p_request_id
  );

  return jsonb_build_object(
    'top_size_codes', to_jsonb(v_top_clean),
    'bottom_size_codes', to_jsonb(v_bottom_clean),
    'shoes_size_codes', to_jsonb(v_shoes_clean)
  );
end;
$$;

grant execute on function public.set_user_profile_sizes(text[], text[], text[], uuid) to authenticated;
