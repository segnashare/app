-- Sécurité (audit 2026-09-26, C5 / H1) :
--   * un membre ne peut plus modifier que les colonnes « profil » de sa ligne `public.users`
--     (plus de levée de suspension, de sortie du mode démo, de bannissement/suppression auto-modifiables) ;
--   * un numéro de téléphone ne peut être enregistré sur `public.users` que s'il est confirmé côté Supabase Auth
--     (`auth.users.phone` + `phone_confirmed_at`), que ce soit par UPDATE direct ou via `set_user_phone_verified`.
--
-- Les routes serveur qui changent `onboarding_mode` / `onboarding_started_at` / `onboarding_completed_at`
-- utilisent désormais le client service role (segna-app/src/app/api/onboarding/*).

-- ---------------------------------------------------------------------------------------------
-- C5 : privilèges par colonne sur public.users
-- ---------------------------------------------------------------------------------------------
revoke update on table public.users from anon, authenticated;
revoke delete on table public.users from anon, authenticated;
grant update (
  first_name,
  last_name,
  locale,
  timezone,
  adress,
  birth_date,
  email,
  phone,
  referrer_bonus_modal,
  onboarding_process,
  updated_at
) on table public.users to authenticated;

-- ---------------------------------------------------------------------------------------------
-- H1 : téléphone vérifié par OTP obligatoire (trigger + RPC)
-- ---------------------------------------------------------------------------------------------
create or replace function public.enforce_users_phone_change_verified()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_new text;
  v_old text;
  v_auth_phone text;
  v_confirmed timestamptz;
begin
  v_new := nullif(regexp_replace(coalesce(new.phone, ''), '\D', '', 'g'), '');
  if v_new is null then
    return new; -- effacement du numéro toujours autorisé
  end if;

  if tg_op = 'UPDATE' then
    v_old := nullif(regexp_replace(coalesce(old.phone, ''), '\D', '', 'g'), '');
    if v_old = v_new then
      return new; -- numéro inchangé
    end if;
  end if;

  -- Service role, migrations / jobs sans JWT et staff admin : pas de contrainte.
  if coalesce(auth.role(), '') = 'service_role' or auth.uid() is null then
    return new;
  end if;
  if public.user_is_staff_admin(new.id) then
    return new;
  end if;

  -- Un membre ne peut écrire que sur sa propre ligne (la RLS l'impose déjà, on le re-vérifie ici).
  if new.id is distinct from auth.uid() then
    raise exception using errcode = '42501', message = 'Modification de téléphone non autorisée.';
  end if;

  select regexp_replace(coalesce(au.phone, ''), '\D', '', 'g'), au.phone_confirmed_at
    into v_auth_phone, v_confirmed
  from auth.users au
  where au.id = new.id;

  if v_auth_phone is distinct from v_new or v_confirmed is null then
    raise exception using
      errcode = '42501',
      message = 'Numéro non vérifié : valide le code SMS avant d''enregistrer ce numéro.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_users_enforce_phone_verified on public.users;
create trigger trg_users_enforce_phone_verified
before insert or update of phone on public.users
for each row execute function public.enforce_users_phone_change_verified();

-- La RPC refuse explicitement un numéro non confirmé (le trigger ci-dessus reste le filet de sécurité).
create or replace function public.set_user_phone_verified(p_phone_e164 text, p_request_id uuid default null)
returns public.users
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid;
  v_phone text;
  v_digits text;
  v_auth_phone text;
  v_confirmed timestamptz;
  v_row public.users;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  v_phone := nullif(trim(p_phone_e164), '');
  if v_phone is null then
    raise exception 'Phone is required';
  end if;
  v_digits := nullif(regexp_replace(v_phone, '\D', '', 'g'), '');

  if not public.user_is_staff_admin(v_uid) then
    select regexp_replace(coalesce(au.phone, ''), '\D', '', 'g'), au.phone_confirmed_at
      into v_auth_phone, v_confirmed
    from auth.users au
    where au.id = v_uid;

    if v_auth_phone is distinct from v_digits or v_confirmed is null then
      raise exception using
        errcode = '42501',
        message = 'Numéro non vérifié : valide le code SMS avant d''enregistrer ce numéro.';
    end if;
  end if;

  insert into public.users (id, phone)
  values (v_uid, v_phone)
  on conflict (id) do update set phone = excluded.phone
  returning * into v_row;

  perform public.log_activity_event(
    p_event_name => 'set_user_phone_verified',
    p_payload => jsonb_build_object('phone', v_phone),
    p_request_id => p_request_id
  );

  return v_row;
end;
$$;

revoke all on function public.set_user_phone_verified(text, uuid) from public, anon;
grant execute on function public.set_user_phone_verified(text, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
