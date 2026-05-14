-- Parrainage différé : à l’inscription on mémorise seulement `pending_referral_code`.
-- Crédits + `referrals` + wallet_transactions + modale parrain quand téléphone vérifié **et** onboarding terminé
-- (`qualify_pending_referral`, appelée depuis `complete_onboarding` et côté app après vérif téléphone).

alter table public.users
  add column if not exists pending_referral_code text null;

comment on column public.users.pending_referral_code is
  'Code parrainage saisi à l’inscription ; traité par `qualify_pending_referral` une fois tél. vérifié + onboarding complété.';

-- ---------------------------------------------------------------------------
-- Qualification parrainage (idempotent)
-- ---------------------------------------------------------------------------

create or replace function public.qualify_pending_referral(
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_pending text;
  v_ref_lower text;
  v_rc_id uuid;
  v_referrer uuid;
  v_rc_text text;
  v_bonus constant bigint := 100;
  v_referral_id uuid;
  v_wt_ref uuid;
  v_wt_parr uuid;
  v_referred_display text;
  v_phone_ok boolean;
  v_onboarding_done boolean;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if exists (select 1 from public.referrals r where r.referred_user_id = v_uid) then
    update public.users u set pending_referral_code = null where u.id = v_uid and u.pending_referral_code is not null;
    return jsonb_build_object('qualified', false, 'reason', 'already_referred');
  end if;

  select nullif(trim(u.pending_referral_code), '')
  into v_pending
  from public.users u
  where u.id = v_uid;

  if v_pending is null or length(v_pending) = 0 then
    return jsonb_build_object('qualified', false, 'reason', 'no_pending_code');
  end if;

  select
    coalesce(
      (u.phone is not null and length(trim(u.phone)) > 0)
      and exists (
        select 1
        from auth.users au
        where au.id = u.id
          and au.phone is not null
          and trim(au.phone) <> ''
          and au.phone_confirmed_at is not null
      ),
      false
    )
  into v_phone_ok
  from public.users u
  where u.id = v_uid;

  if not coalesce(v_phone_ok, false) then
    return jsonb_build_object('qualified', false, 'reason', 'phone_not_verified');
  end if;

  select
    exists (
      select 1
      from public.onboarding_sessions os
      where os.user_id = v_uid
        and os.status = 'completed'
    )
    or exists (
      select 1
      from public.users u2
      where u2.id = v_uid
        and u2.onboarding_completed_at is not null
    )
  into v_onboarding_done;

  if not coalesce(v_onboarding_done, false) then
    return jsonb_build_object('qualified', false, 'reason', 'onboarding_incomplete');
  end if;

  v_ref_lower := lower(v_pending);
  select rc.id, rc.user_id, rc.code
  into v_rc_id, v_referrer, v_rc_text
  from public.referrals_codes rc
  where rc.is_active is true
    and lower(rc.code) = v_ref_lower
  limit 1;

  if v_rc_id is null or v_referrer is not distinct from v_uid then
    update public.users u set pending_referral_code = null where u.id = v_uid;
    return jsonb_build_object('qualified', false, 'reason', 'invalid_or_self_referral');
  end if;

  begin
    insert into public.referrals (
      referrer_user_id,
      referred_user_id,
      referral_code_id,
      referral_code,
      status,
      source_type,
      source_id,
      qualified_at,
      request_id,
      metadata
    )
    values (
      v_referrer,
      v_uid,
      v_rc_id,
      v_rc_text,
      'qualified',
      'invite_link',
      v_pending,
      now(),
      p_request_id,
      jsonb_build_object('bonus_consumption_points_each', v_bonus, 'qualified_via', 'deferred')
    )
    returning id into v_referral_id;

    v_referred_display := coalesce(
      nullif(trim((select u3.first_name from public.users u3 where u3.id = v_uid)), ''),
      nullif(
        initcap(split_part(trim(coalesce((select au.email from auth.users au where au.id = v_uid), '')), '@', 1)),
        ''
      ),
      'Ton invitée'
    );

    insert into public.wallet_transactions (
      user_id,
      kind,
      direction,
      amount_points,
      status,
      idempotency_key,
      metadata,
      credit_bucket
    )
    values (
      v_uid,
      'credit',
      'credit',
      v_bonus,
      'posted',
      format('referral_signup_bonus:%s:referred', v_referral_id),
      jsonb_build_object(
        'source', 'referral_signup_bonus',
        'credits_kind', 'consumption',
        'referral_id', v_referral_id,
        'referrer_user_id', v_referrer,
        'role', 'referred'
      ),
      'consumption'
    )
    on conflict (idempotency_key) do nothing
    returning id into v_wt_ref;

    if v_wt_ref is not null then
      update public.user_wallets uw
      set balance_consumption_points = coalesce(uw.balance_consumption_points, 0) + v_bonus
      where uw.user_id = v_uid;
    end if;

    insert into public.user_wallets (user_id, balance_consumption_points, balance_exchange_points)
    values (v_referrer, 0, null)
    on conflict (user_id) do nothing;

    insert into public.wallet_transactions (
      user_id,
      kind,
      direction,
      amount_points,
      status,
      idempotency_key,
      metadata,
      credit_bucket
    )
    values (
      v_referrer,
      'credit',
      'credit',
      v_bonus,
      'posted',
      format('referral_signup_bonus:%s:referrer', v_referral_id),
      jsonb_build_object(
        'source', 'referral_signup_bonus',
        'credits_kind', 'consumption',
        'referral_id', v_referral_id,
        'referred_user_id', v_uid,
        'role', 'referrer'
      ),
      'consumption'
    )
    on conflict (idempotency_key) do nothing
    returning id into v_wt_parr;

    if v_wt_parr is not null then
      update public.user_wallets uw
      set balance_consumption_points = coalesce(uw.balance_consumption_points, 0) + v_bonus
      where uw.user_id = v_referrer;
    end if;

    update public.users u
    set referrer_bonus_modal = jsonb_build_object(
      'referred_display_name', v_referred_display,
      'points', v_bonus,
      'referral_id', v_referral_id,
      'referred_user_id', v_uid
    )
    where u.id = v_referrer;

    update public.users u
    set pending_referral_code = null
    where u.id = v_uid;

    perform public.log_activity_event(
      'referral_qualified_deferred',
      jsonb_build_object(
        'referral_id', v_referral_id,
        'referrer_user_id', v_referrer,
        'referred_user_id', v_uid
      ),
      p_request_id
    );

    return jsonb_build_object('qualified', true, 'referral_id', v_referral_id);
  exception
    when unique_violation then
      update public.users u set pending_referral_code = null where u.id = v_uid;
      return jsonb_build_object('qualified', false, 'reason', 'unique_violation');
  end;
end;
$$;

grant execute on function public.qualify_pending_referral(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Bootstrap : ne plus créditer tout de suite — seulement `pending_referral_code`
-- ---------------------------------------------------------------------------

create or replace function public.bootstrap_user_after_signup(
  p_first_name text default null,
  p_last_name text default null,
  p_locale text default null,
  p_timezone text default null,
  p_request_id uuid default null,
  p_referral_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_email text;
  v_phone text;
  v_ref_raw text;
  v_ref_lower text;
  v_rc_id uuid;
  v_referrer uuid;
  v_referral_pending boolean := false;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select email, phone
  into v_email, v_phone
  from auth.users
  where id = v_uid;

  insert into public.users (id, email, phone, first_name, last_name, locale, timezone)
  values (v_uid, v_email, v_phone, p_first_name, p_last_name, p_locale, p_timezone)
  on conflict (id) do update
  set email = excluded.email,
      phone = excluded.phone,
      first_name = coalesce(excluded.first_name, public.users.first_name),
      last_name = coalesce(excluded.last_name, public.users.last_name),
      locale = coalesce(excluded.locale, public.users.locale),
      timezone = coalesce(excluded.timezone, public.users.timezone);

  insert into public.user_roles (user_id, role)
  values (v_uid, 'user')
  on conflict (user_id, role) do nothing;

  insert into public.user_wallets (user_id, balance_consumption_points, balance_exchange_points)
  values (v_uid, 0, null)
  on conflict (user_id) do nothing;

  insert into public.user_profiles (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  insert into public.onboarding_sessions (user_id, status, current_step, progress)
  values (v_uid, 'in_progress', '/onboarding/1', jsonb_build_object('checkpoint', '/onboarding/1'))
  on conflict (user_id) do nothing;

  v_ref_raw := trim(coalesce(p_referral_code, ''));
  if length(v_ref_raw) > 0 then
    v_ref_lower := lower(v_ref_raw);
    select rc.id, rc.user_id
    into v_rc_id, v_referrer
    from public.referrals_codes rc
    where rc.is_active is true
      and lower(rc.code) = v_ref_lower
    limit 1;

    if v_rc_id is not null and v_referrer is distinct from v_uid then
      if not exists (select 1 from public.referrals r where r.referred_user_id = v_uid) then
        update public.users u
        set pending_referral_code = v_ref_raw
        where u.id = v_uid;
        v_referral_pending := true;
      end if;
    end if;
  end if;

  perform public.log_activity_event(
    'bootstrap_user_after_signup',
    jsonb_build_object(
      'first_name', p_first_name,
      'last_name', p_last_name,
      'locale', p_locale,
      'timezone', p_timezone,
      'referral_code_param', nullif(v_ref_raw, ''),
      'referral_pending_capture', v_referral_pending
    ),
    p_request_id
  );

  return public.get_me_context();
end;
$$;

grant execute on function public.bootstrap_user_after_signup(text, text, text, text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Fin onboarding (étape 3) : tenter la qualification parrain
-- ---------------------------------------------------------------------------

create or replace function public.complete_onboarding(
  p_answers_json jsonb default '{}'::jsonb,
  p_visibility_json jsonb default '{}'::jsonb,
  p_request_id uuid default null
)
returns public.onboarding_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_row public.onboarding_sessions;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.user_profiles (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  update public.user_profiles
  set profile_data = coalesce(profile_data, '{}'::jsonb) || jsonb_strip_nulls(
        jsonb_build_object(
          'location', case when p_answers_json ? 'location' then p_answers_json->'location' end,
          'sizes',    case when p_answers_json ? 'size' then p_answers_json->'size' end,
          'work',     case when p_answers_json ? 'work' then p_answers_json->'work' end
        )
      ),
      looks = case when p_answers_json ? 'looks' and jsonb_typeof(p_answers_json->'looks') = 'array'
                   then p_answers_json->'looks' else looks end,
      answers = case when p_answers_json ? 'answers' and jsonb_typeof(p_answers_json->'answers') = 'array'
                     then p_answers_json->'answers' else answers end
  where user_id = v_uid;

  update public.onboarding_sessions
  set status = 'completed',
      completed_at = now(),
      current_step = '/onboarding/end',
      progress = coalesce(progress, '{}'::jsonb) || jsonb_build_object('checkpoint', '/onboarding/end')
  where user_id = v_uid
  returning * into v_row;

  if not found then
    insert into public.onboarding_sessions (user_id, status, current_step, progress, completed_at)
    values (v_uid, 'completed', '/onboarding/end', jsonb_build_object('checkpoint', '/onboarding/end'), now())
    returning * into v_row;
  end if;

  update public.users
  set status = 'active',
      onboarding_completed_at = now()
  where id = v_uid;

  perform public.log_activity_event(
    'complete_onboarding',
    jsonb_build_object('answers', coalesce(p_answers_json, '{}'::jsonb), 'visibility', coalesce(p_visibility_json, '{}'::jsonb)),
    p_request_id
  );

  perform public.qualify_pending_referral(p_request_id);

  return v_row;
end;
$$;

grant execute on function public.complete_onboarding(jsonb, jsonb, uuid) to authenticated;

create or replace function public.complete_onboarding()
returns public.onboarding_sessions
language sql
security definer
set search_path = public
as $$
  select public.complete_onboarding('{}'::jsonb, '{}'::jsonb, null);
$$;

grant execute on function public.complete_onboarding() to authenticated;
