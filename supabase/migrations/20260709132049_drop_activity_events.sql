-- Suppression du journal d'activité (table activity_events) et des écritures associées.
-- Les RPC existantes continuent d'appeler log_activity_event* (no-op).

-- ---------------------------------------------------------------------------
-- 1) Idempotence récompenses XP (remplace activity_events)
-- ---------------------------------------------------------------------------

create table if not exists public.xp_reward_grants (
  user_id uuid not null references public.users (id) on delete cascade,
  reward_code text not null,
  granted_at timestamptz not null default timezone('utc', now()),
  trigger_event text,
  level_no smallint,
  badge_code text,
  reward_type text,
  wallet_amount numeric(12, 2),
  request_id uuid,
  primary key (user_id, reward_code)
);

comment on table public.xp_reward_grants is
  'Récompenses XP one-time déjà accordées (remplace activity_events xp_reward_granted).';

insert into public.xp_reward_grants (
  user_id,
  reward_code,
  granted_at,
  trigger_event,
  level_no,
  badge_code,
  reward_type,
  wallet_amount,
  request_id
)
select
  e.user_id,
  e.payload ->> 'reward_code',
  e.created_at,
  e.payload ->> 'trigger_event',
  nullif(e.payload ->> 'level_no', '')::smallint,
  e.payload ->> 'badge_code',
  e.payload ->> 'reward_type',
  nullif(e.payload ->> 'wallet_amount', '')::numeric(12, 2),
  null::uuid
from public.activity_events e
where e.event_name = 'xp_reward_granted'
  and e.user_id is not null
  and coalesce(e.payload ->> 'reward_code', '') <> ''
on conflict (user_id, reward_code) do nothing;

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
  v_wallet_delta numeric(12, 2) := 0;
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
        from public.xp_reward_grants g
        where g.user_id = p_user_id
          and g.reward_code = v_reward.reward_code
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

    insert into public.xp_reward_grants (
      user_id,
      reward_code,
      trigger_event,
      level_no,
      badge_code,
      reward_type,
      wallet_amount,
      request_id
    )
    values (
      p_user_id,
      v_reward.reward_code,
      p_trigger_event,
      p_level_no,
      p_badge_code,
      v_reward.reward_type,
      v_reward.wallet_amount,
      p_request_id
    )
    on conflict (user_id, reward_code) do nothing;

    v_granted := v_granted + 1;
  end loop;

  return jsonb_build_object(
    'granted_rewards', v_granted,
    'wallet_delta', v_wallet_delta
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) No-op des helpers d'écriture (RPC / app / backoffice)
-- ---------------------------------------------------------------------------

create or replace function public.log_activity_event(
  p_event_name text,
  p_payload jsonb default '{}'::jsonb,
  p_request_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  null;
end;
$$;

create or replace function public.log_activity_event_staff(
  p_event_name text,
  p_action text,
  p_subject_user_id uuid,
  p_resource_type public.activity_resource_type,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_severity public.activity_severity default 'info',
  p_payload jsonb default '{}'::jsonb,
  p_request_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  null;
end;
$$;

create or replace function public.log_activity_event_rpc(
  p_event_name text,
  p_action text,
  p_subject_user_id uuid,
  p_resource_type public.activity_resource_type,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_severity public.activity_severity default 'info',
  p_payload jsonb default '{}'::jsonb,
  p_request_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) Triggers audit DB → activity_events
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select t.tgname, c.relname, n.nspname
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal
      and pg_get_triggerdef(t.oid) ilike '%audit_activity_event_from_db_trigger%'
  loop
    execute format(
      'drop trigger if exists %I on %I.%I',
      r.tgname,
      r.nspname,
      r.relname
    );
  end loop;
end;
$$;

drop function if exists public.audit_activity_event_from_db_trigger() cascade;

-- ---------------------------------------------------------------------------
-- 4) Table activity_events + dépendances
-- ---------------------------------------------------------------------------

drop index if exists public.activity_events_xp_reward_granted_once_idx;
drop policy if exists "activity_events_select_own" on public.activity_events;
drop policy if exists "activity_events_select_admin" on public.activity_events;
drop policy if exists "activity_events_insert_service" on public.activity_events;

drop table if exists public.activity_events cascade;

drop function if exists public.map_entity_type_to_resource_type(text);

-- ---------------------------------------------------------------------------
-- 5) Dernière activité membre (sans activity_events)
-- ---------------------------------------------------------------------------

create or replace function public.get_members_last_app_activity_at(p_user_ids uuid[])
returns table(user_id uuid, last_activity_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select
    u.id as user_id,
    greatest(
      u.updated_at,
      coalesce(fh.last_at, '-infinity'::timestamptz)
    ) as last_activity_at
  from unnest(coalesce(p_user_ids, array[]::uuid[])) as uid(id)
  join public.users u on u.id = uid.id
  left join lateral (
    select max(h.last_seen_at) as last_at
    from public.member_feed_entity_history h
    where h.member_user_id = u.id
  ) fh on true;
$$;

comment on function public.get_members_last_app_activity_at(uuid[]) is
  'Dernière activité membre (users.updated_at, feed) pour rappels SMS engagement.';
