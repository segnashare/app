-- Même garde-fou que 27200000 : INSERT (user_id, city, profile_data) seul peut laisser
-- preferences / looks / answers / photos NULL sur certaines configs.

create or replace function public.sync_user_profile_location_from_users()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_timezone text;
  v_relative_city text;
begin
  v_timezone := coalesce(new.timezone, 'Europe/Paris');
  v_relative_city := public.derive_relative_city_from_adress(new.adress);

  insert into public.user_profiles (
    user_id,
    city,
    photos,
    profile_data,
    preferences,
    looks,
    answers
  )
  values (
    new.id,
    v_relative_city,
    '[]'::jsonb,
    jsonb_build_object(
      'location',
      jsonb_build_object(
        'label', new.adress,
        'timezone', v_timezone
      )
    ),
    '{}'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb
  )
  on conflict (user_id) do update
  set city = excluded.city,
      profile_data = jsonb_set(
        jsonb_set(
          coalesce(public.user_profiles.profile_data, '{}'::jsonb),
          '{location,label}',
          to_jsonb(new.adress),
          true
        ),
        '{location,timezone}',
        to_jsonb(v_timezone),
        true
      );

  return new;
end;
$$;
