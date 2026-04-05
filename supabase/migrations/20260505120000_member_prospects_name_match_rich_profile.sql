-- Prospects : email/téléphone optionnels ; rattachement par prénom+nom (normalisés) si pas d’email prospect.
-- Si le prospect a un email, seul un compte avec le même email peut le claim (évite homonymes).
-- Profil riche (avatar, looks, etc.) stocké sur member_prospects puis fusionné dans user_profiles à l’inscription.

alter table public.member_prospects
  alter column email drop not null;

-- Anciennes lignes sans prénom/nom : dérivés minimaux pour satisfaire l’unicité « nom complet ».
update public.member_prospects
set
  first_name = case
    when length(trim(coalesce(first_name, ''))) = 0 then coalesce(nullif(split_part(lower(trim(coalesce(email, ''))), '@', 1), ''), 'Prospect')
    else trim(first_name)
  end,
  last_name = case
    when length(trim(coalesce(last_name, ''))) = 0 then '—'
    else trim(last_name)
  end
where length(trim(coalesce(first_name, ''))) = 0
   or length(trim(coalesce(last_name, ''))) = 0;

alter table public.member_prospects
  add column if not exists display_name text,
  add column if not exists bio text,
  add column if not exists avatar_url text,
  add column if not exists photos jsonb not null default '[]'::jsonb,
  add column if not exists profile_data jsonb not null default '{}'::jsonb,
  add column if not exists preferences jsonb not null default '{}'::jsonb,
  add column if not exists looks jsonb not null default '[]'::jsonb,
  add column if not exists answers jsonb not null default '[]'::jsonb,
  add column if not exists birth_date date;

alter table public.member_prospects
  add constraint member_prospects_names_required check (
    length(trim(coalesce(first_name, ''))) > 0
    and length(trim(coalesce(last_name, ''))) > 0
  );

drop index if exists public.member_prospects_email_lower_trim_uq;

create unique index if not exists member_prospects_unclaimed_email_lower_uq
  on public.member_prospects ((lower(trim(email))))
  where claimed_user_id is null
    and email is not null
    and length(trim(email)) > 0;

create unique index if not exists member_prospects_unclaimed_name_lower_uq
  on public.member_prospects ((lower(trim(first_name))), (lower(trim(last_name))))
  where claimed_user_id is null;

comment on table public.member_prospects is
  'Fiche sans auth : claim par email si email prospect renseigné, sinon par prénom+nom (insensible casse / trim). Profil fusionné dans user_profiles au claim.';

-- ---------------------------------------------------------------------------
-- Claim : email strict si prospect.email présent ; sinon match prénom+nom sur public.users
-- ---------------------------------------------------------------------------

create or replace function public.claim_member_prospect_for_new_user()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_email text;
  v_fn text;
  v_ln text;
  v_prospect_id uuid;
  v_p_fn text;
  v_p_ln text;
  v_p_email text;
  v_disp text;
  v_bio text;
  v_avatar text;
  v_photos jsonb;
  v_profile_data jsonb;
  v_preferences jsonb;
  v_looks jsonb;
  v_answers jsonb;
  v_birth date;
  v_match text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return;
  end if;

  select u.first_name, u.last_name, a.email
  into v_fn, v_ln, v_email
  from public.users u
  join auth.users a on a.id = u.id
  where u.id = v_uid;

  v_fn := trim(coalesce(v_fn, ''));
  v_ln := trim(coalesce(v_ln, ''));
  v_email := trim(coalesce(v_email, ''));

  select
    mp.id,
    mp.first_name,
    mp.last_name,
    mp.email,
    mp.display_name,
    mp.bio,
    mp.avatar_url,
    mp.photos,
    mp.profile_data,
    mp.preferences,
    mp.looks,
    mp.answers,
    mp.birth_date
  into
    v_prospect_id,
    v_p_fn,
    v_p_ln,
    v_p_email,
    v_disp,
    v_bio,
    v_avatar,
    v_photos,
    v_profile_data,
    v_preferences,
    v_looks,
    v_answers,
    v_birth
  from public.member_prospects mp
  where mp.claimed_user_id is null
    and (
      (
        mp.email is not null
        and length(trim(mp.email)) > 0
        and length(v_email) > 0
        and lower(trim(mp.email)) = lower(v_email)
      )
      or (
        (mp.email is null or length(trim(mp.email)) = 0)
        and length(v_fn) > 0
        and length(v_ln) > 0
        and lower(trim(mp.first_name)) = lower(v_fn)
        and lower(trim(mp.last_name)) = lower(v_ln)
      )
    )
  order by mp.created_at asc
  limit 1;

  if v_prospect_id is null then
    return;
  end if;

  if v_p_email is not null and length(trim(v_p_email)) > 0 then
    v_match := 'email';
  else
    v_match := 'name';
  end if;

  update public.member_prospects
  set
    claimed_user_id = v_uid,
    claimed_at = now(),
    updated_at = now()
  where id = v_prospect_id;

  update public.users u
  set
    first_name = case
      when nullif(trim(u.first_name), '') is null then nullif(trim(v_p_fn), '')
      else u.first_name
    end,
    last_name = case
      when nullif(trim(u.last_name), '') is null then nullif(trim(v_p_ln), '')
      else u.last_name
    end,
    birth_date = case
      when u.birth_date is null then v_birth
      else u.birth_date
    end
  where u.id = v_uid;

  insert into public.user_profiles (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  update public.user_profiles up
  set
    display_name = case
      when nullif(trim(up.display_name), '') is null and v_disp is not null and length(trim(v_disp)) > 0
        then trim(v_disp)
      else up.display_name
    end,
    bio = case
      when nullif(trim(up.bio), '') is null and v_bio is not null and length(trim(v_bio)) > 0
        then trim(v_bio)
      else up.bio
    end,
    avatar_url = case
      when nullif(trim(up.avatar_url), '') is null and v_avatar is not null and length(trim(v_avatar)) > 0
        then trim(v_avatar)
      else up.avatar_url
    end,
    photos = case
      when (up.photos is null or up.photos = '[]'::jsonb)
        and v_photos is not null
        and v_photos <> '[]'::jsonb
        then v_photos
      else up.photos
    end,
    profile_data = case
      when (up.profile_data is null or up.profile_data = '{}'::jsonb)
        and v_profile_data is not null
        and v_profile_data <> '{}'::jsonb
        then v_profile_data
      else coalesce(up.profile_data, '{}'::jsonb) || coalesce(v_profile_data, '{}'::jsonb)
    end,
    preferences = case
      when (up.preferences is null or up.preferences = '{}'::jsonb)
        and v_preferences is not null
        and v_preferences <> '{}'::jsonb
        then v_preferences
      else coalesce(up.preferences, '{}'::jsonb) || coalesce(v_preferences, '{}'::jsonb)
    end,
    looks = case
      when (up.looks is null or up.looks = '[]'::jsonb)
        and v_looks is not null
        and v_looks <> '[]'::jsonb
        then v_looks
      else up.looks
    end,
    answers = case
      when (up.answers is null or up.answers = '[]'::jsonb)
        and v_answers is not null
        and v_answers <> '[]'::jsonb
        then v_answers
      else up.answers
    end,
    updated_at = now()
  where up.user_id = v_uid;

  update public.items
  set
    owner_user_id = v_uid,
    intended_prospect_id = null
  where intended_prospect_id = v_prospect_id;

  perform public.log_activity_event(
    'member_prospect_claimed',
    jsonb_build_object(
      'prospect_id', v_prospect_id,
      'user_id', v_uid,
      'match', v_match,
      'email', nullif(v_email, '')
    ),
    null
  );
end;
$$;
