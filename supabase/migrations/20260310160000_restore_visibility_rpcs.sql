create or replace function public.get_or_create_user_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_visibility jsonb;
  v_defaults jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.user_preferences (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  select visibility
  into v_visibility
  from public.user_preferences
  where user_id = v_uid;

  v_defaults := jsonb_build_object(
    'style_visible', true,
    'brands_visible', true,
    'motivation_visible', true,
    'experience_visible', true,
    'share_visible', true,
    'budget_visible', true,
    'dressing_visible', true,
    'ethic_visible', true,
    'privacy_visible', true,
    'looks_visible', true,
    'answers_visible', true
  );

  return v_defaults || coalesce(v_visibility, '{}'::jsonb);
end;
$$;

create or replace function public.set_user_data_visibility(
  p_section text,
  p_visible boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_next_visibility jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.user_preferences (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  update public.user_preferences
  set visibility = coalesce(visibility, '{}'::jsonb) || jsonb_build_object(p_section || '_visible', p_visible)
  where user_id = v_uid
  returning visibility into v_next_visibility;

  return coalesce(v_next_visibility, '{}'::jsonb);
end;
$$;

grant execute on function public.get_or_create_user_data() to authenticated;
grant execute on function public.set_user_data_visibility(text, boolean) to authenticated;
