-- Parrainage : plus de crédits conso offerts à l'inscription (filleul / parrain).
-- La qualification `referrals` et le suivi restent ; seuls les crédits wallet sont supprimés.

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
  v_bonus constant bigint := 0;
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

    if v_bonus > 0 then
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

comment on function public.qualify_pending_referral(uuid) is
  'Qualifie un parrainage différé (sans crédits wallet offerts depuis 2026-06).';
