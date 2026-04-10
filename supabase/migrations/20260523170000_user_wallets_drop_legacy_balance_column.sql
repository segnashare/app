-- Répare la table wallet après suppression manuelle de la colonne legacy `balance` (numeric).
-- - Garantit `balance_points` (total bigint, maintenu par trigger) + colonnes split si besoin.
-- - Met à jour les RPC qui inséraient encore `(user_id, balance)`.
-- - Supprime définitivement `balance` si elle traîne encore.
--
-- Trigger historique (hors chaîne migrations) qui synchronisait balance <-> balance_points :
-- à retirer sinon erreur « record new has no field balance » après drop de `balance`.
drop trigger if exists trg_sync_user_wallets_balance_columns on public.user_wallets;
drop function if exists public.sync_user_wallets_balance_columns();

alter table public.user_wallets
  add column if not exists balance_points bigint not null default 0;

comment on column public.user_wallets.balance_points is
  'Total points (consommation + échange), synchronisé par trg_user_wallets_sync_balance_points_total.';

alter table public.user_wallets
  add column if not exists balance_consumption_points bigint not null default 0,
  add column if not exists balance_exchange_points bigint not null default 0;

-- Total cohérent si seules les colonnes split sont renseignées
update public.user_wallets uw
set balance_points =
  greatest(0, coalesce(uw.balance_consumption_points, 0) + coalesce(uw.balance_exchange_points, 0))
where coalesce(uw.balance_points, 0) = 0
  and (coalesce(uw.balance_consumption_points, 0) + coalesce(uw.balance_exchange_points, 0)) > 0;

-- Legacy : total > 0 mais split à zéro → tout sur échange (même règle que 20260516120000)
update public.user_wallets uw
set
  balance_exchange_points = greatest(0, coalesce(uw.balance_points, 0)),
  balance_consumption_points = 0
where coalesce(uw.balance_consumption_points, 0) = 0
  and coalesce(uw.balance_exchange_points, 0) = 0
  and coalesce(uw.balance_points, 0) > 0;

create or replace function public.user_wallets_sync_balance_points_total()
returns trigger
language plpgsql
as $trg$
begin
  if tg_op = 'INSERT' then
    if coalesce(new.balance_consumption_points, 0) = 0
       and coalesce(new.balance_exchange_points, 0) = 0
       and coalesce(new.balance_points, 0) > 0 then
      new.balance_exchange_points := greatest(0::bigint, coalesce(new.balance_points, 0)::bigint);
      new.balance_consumption_points := 0;
    end if;
  end if;
  new.balance_points :=
    coalesce(new.balance_consumption_points, 0) + coalesce(new.balance_exchange_points, 0);
  return new;
end;
$trg$;

drop trigger if exists trg_user_wallets_sync_balance_points_total on public.user_wallets;

create trigger trg_user_wallets_sync_balance_points_total
before insert or update of balance_consumption_points, balance_exchange_points
on public.user_wallets
for each row
execute function public.user_wallets_sync_balance_points_total();

-- Recalcul des totaux
update public.user_wallets uw
set
  balance_consumption_points = uw.balance_consumption_points,
  balance_exchange_points = uw.balance_exchange_points;

-- ---------------------------------------------------------------------------
-- Bootstrap : plus de colonne `balance`
-- ---------------------------------------------------------------------------

create or replace function public.bootstrap_user_after_signup(
  p_first_name text default null,
  p_last_name text default null,
  p_locale text default null,
  p_timezone text default null,
  p_request_id uuid default null
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
  values (v_uid, 'in_progress', '/onboarding/welcome', jsonb_build_object('checkpoint', '/onboarding/welcome'))
  on conflict (user_id) do nothing;

  perform public.log_activity_event(
    p_event_name => 'bootstrap_user_after_signup',
    p_payload => jsonb_build_object(
      'first_name', p_first_name,
      'last_name', p_last_name,
      'locale', p_locale,
      'timezone', p_timezone
    ),
    p_request_id => p_request_id
  );

  return public.get_me_context();
end;
$$;

grant execute on function public.bootstrap_user_after_signup(text, text, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- XP : crédit wallet sur compte consommation (équivalent ancien solde unique générique)
-- ---------------------------------------------------------------------------

create or replace function public.xp_grant_rewards_for_event(
  p_user_id uuid,
  p_trigger_event text,
  p_level_no smallint default null,
  p_badge_code text default null,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reward record;
  v_granted integer := 0;
  v_wallet_delta numeric(12,2) := 0;
  v_existing boolean;
  v_pts bigint;
begin
  for v_reward in
    select *
    from public.xp_rewards r
    where r.is_active = true
      and r.trigger_event = p_trigger_event
      and (
        (p_trigger_event = 'level_up' and r.level_no = p_level_no)
        or (p_trigger_event = 'badge_awarded' and r.badge_code = p_badge_code)
      )
  loop
    v_existing := false;

    if v_reward.one_time then
      select exists (
        select 1
        from public.activity_events e
        where e.user_id = p_user_id
          and e.event_name = 'xp_reward_granted'
          and e.payload->>'reward_code' = v_reward.reward_code
      ) into v_existing;
    end if;

    if v_existing then
      continue;
    end if;

    if v_reward.reward_type = 'wallet_credit' and coalesce(v_reward.wallet_amount, 0) > 0 then
      v_pts := greatest(0::bigint, trunc(coalesce(v_reward.wallet_amount, 0))::bigint);

      insert into public.user_wallets (user_id, balance_consumption_points, balance_exchange_points)
      values (p_user_id, 0, null)
      on conflict (user_id) do nothing;

      update public.user_wallets uw
      set balance_consumption_points = uw.balance_consumption_points + v_pts
      where user_id = p_user_id;

      v_wallet_delta := v_wallet_delta + v_reward.wallet_amount;
    end if;

    insert into public.activity_events (user_id, event_name, payload, request_id)
    values (
      p_user_id,
      'xp_reward_granted',
      jsonb_build_object(
        'reward_code', v_reward.reward_code,
        'trigger_event', p_trigger_event,
        'level_no', p_level_no,
        'badge_code', p_badge_code,
        'reward_type', v_reward.reward_type,
        'wallet_amount', v_reward.wallet_amount
      ),
      p_request_id
    );

    v_granted := v_granted + 1;
  end loop;

  return jsonb_build_object(
    'granted_rewards', v_granted,
    'wallet_delta', v_wallet_delta
  );
end;
$$;

alter table public.user_wallets drop column if exists balance;
