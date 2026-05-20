-- Parrainage : lignes `wallet_transactions` (consumption) pour filleul + parrain,
-- et `users.referrer_bonus_modal` pour afficher la modale / déclencher le SMS côté parrain.

alter table public.users
  add column if not exists referrer_bonus_modal jsonb null;

comment on column public.users.referrer_bonus_modal is
  'Payload modale « bonus parrain » (referred_display_name, points, referral_id, referred_user_id). Null = rien à afficher.';

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
  v_rc_text text;
  v_bonus constant bigint := 100;
  v_referral_bonus boolean := false;
  v_referral_id uuid;
  v_wt_ref uuid;
  v_wt_parr uuid;
  v_referred_display text;
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
    select rc.id, rc.user_id, rc.code
    into v_rc_id, v_referrer, v_rc_text
    from public.referrals_codes rc
    where rc.is_active is true
      and lower(rc.code) = v_ref_lower
    limit 1;

    if v_rc_id is not null and v_referrer is distinct from v_uid then
      if not exists (select 1 from public.referrals r where r.referred_user_id = v_uid) then
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
            v_ref_raw,
            now(),
            p_request_id,
            jsonb_build_object('bonus_consumption_points_each', v_bonus)
          )
          returning id into v_referral_id;

          v_referred_display := coalesce(
            nullif(trim(p_first_name), ''),
            nullif(initcap(split_part(trim(coalesce(v_email, '')), '@', 1)), ''),
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

          v_referral_bonus := true;
        exception
          when unique_violation then
            null;
        end;
      end if;
    end if;
  end if;

  perform public.log_activity_event(
    p_event_name => 'bootstrap_user_after_signup',
    p_payload => jsonb_build_object(
      'first_name', p_first_name,
      'last_name', p_last_name,
      'locale', p_locale,
      'timezone', p_timezone,
      'referral_code_param', nullif(v_ref_raw, ''),
      'referral_bonus_granted', v_referral_bonus
    ),
    p_request_id => p_request_id
  );

  return public.get_me_context();
end;
$$;

grant execute on function public.bootstrap_user_after_signup(text, text, text, text, uuid, text) to authenticated;
