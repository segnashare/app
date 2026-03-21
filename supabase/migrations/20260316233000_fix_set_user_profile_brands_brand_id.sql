create or replace function public.set_user_profile_brands(
  p_brand_ids uuid[],
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
  v_kept_brand_ids uuid[];
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.user_profiles (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  select id
  into v_user_profile_id
  from public.user_profiles
  where user_id = v_uid;

  with normalized as (
    select brand_id, ordinality
    from unnest(coalesce(p_brand_ids, '{}'::uuid[])) with ordinality as t(brand_id, ordinality)
    where brand_id is not null
  ),
  deduped as (
    select distinct on (brand_id) brand_id, ordinality
    from normalized
    order by brand_id, ordinality
  ),
  limited as (
    select brand_id, ordinality
    from deduped
    order by ordinality
    limit 3
  )
  select coalesce(array_agg(brand_id order by ordinality), '{}'::uuid[])
  into v_kept_brand_ids
  from limited;

  delete from public.user_profile_brands
  where user_profile_id = v_user_profile_id;

  insert into public.user_profile_brands (user_profile_id, brand_id, rank)
  select
    v_user_profile_id,
    brand_id,
    row_number() over (order by ordinality)::smallint
  from (
    select brand_id, ordinality
    from unnest(v_kept_brand_ids) with ordinality as t(brand_id, ordinality)
  ) ranked;

  perform public.log_activity_event(
    p_event_name => 'set_user_profile_brands',
    p_payload => jsonb_build_object('brand_ids', to_jsonb(v_kept_brand_ids)),
    p_request_id => p_request_id
  );

  return jsonb_build_object('brand_ids', to_jsonb(v_kept_brand_ids));
end;
$$;

grant execute on function public.set_user_profile_brands(uuid[], uuid) to authenticated;
