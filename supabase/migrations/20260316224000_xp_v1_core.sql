create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Helpers (roles)
-- ---------------------------------------------------------------------------

create or replace function public.xp_has_role(p_user_id uuid, p_role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = p_user_id
      and lower(ur.role::text) = lower(p_role)
  );
$$;

create or replace function public.xp_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.xp_has_role(auth.uid(), 'admin');
$$;

create or replace function public.xp_is_moderator_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.xp_has_role(auth.uid(), 'moderator')
      or public.xp_has_role(auth.uid(), 'admin');
$$;

-- ---------------------------------------------------------------------------
-- Core XP tables (V1)
-- ---------------------------------------------------------------------------

create table if not exists public.xp_actions (
  action_code text primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  label text not null,
  description text,
  xp_amount integer not null check (xp_amount >= 0),
  is_active boolean not null default true,
  one_time boolean not null default false,
  cap_period text not null default 'none' check (cap_period in ('none', 'day', 'week', 'month', 'lifetime')),
  cap_count integer check (cap_count is null or cap_count > 0),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.xp_levels (
  level_no smallint primary key check (level_no >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  rank_name text not null,
  xp_required integer not null check (xp_required >= 0),
  estimated_active_time text,
  icon text,
  unique (xp_required)
);

create table if not exists public.xp_badges (
  badge_code text primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  label text not null,
  description text,
  xp_bonus integer not null default 0 check (xp_bonus >= 0),
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.xp_user_badges (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  badge_code text not null references public.xp_badges(badge_code) on delete restrict,
  source_type text not null default 'system',
  source_id text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  unique (user_id, badge_code)
);

create table if not exists public.xp_ledger (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action_code text references public.xp_actions(action_code) on delete restrict,
  badge_code text references public.xp_badges(badge_code) on delete restrict,
  award_type text not null check (award_type in ('action', 'badge_awarded', 'admin_adjustment', 'system_bonus')),
  xp_delta integer not null,
  source_type text not null default 'system',
  source_id text not null default '',
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  idempotency_key text unique,
  request_id uuid,
  constraint xp_ledger_action_or_badge_check check (
    (award_type = 'action' and action_code is not null)
    or (award_type = 'badge_awarded' and badge_code is not null)
    or (award_type in ('admin_adjustment', 'system_bonus'))
  ),
  constraint xp_ledger_non_negative_standard check (
    (award_type in ('action', 'badge_awarded', 'system_bonus') and xp_delta >= 0)
    or award_type = 'admin_adjustment'
  )
);

create unique index if not exists xp_ledger_user_action_source_uidx
  on public.xp_ledger (user_id, action_code, source_type, source_id)
  where action_code is not null;

create table if not exists public.xp_user_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  total_xp integer not null default 0 check (total_xp >= 0),
  current_level smallint not null default 1 check (current_level >= 1),
  last_xp_at timestamptz,
  level_progress_percent numeric(5,2) not null default 0 check (level_progress_percent >= 0 and level_progress_percent <= 100),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.xp_rewards (
  reward_code text primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  trigger_event text not null check (trigger_event in ('level_up', 'badge_awarded')),
  level_no smallint references public.xp_levels(level_no) on delete cascade,
  badge_code text references public.xp_badges(badge_code) on delete cascade,
  reward_type text not null check (reward_type in ('wallet_credit', 'perk')),
  wallet_amount numeric(12,2) not null default 0 check (wallet_amount >= 0),
  label text not null,
  description text,
  one_time boolean not null default true,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  constraint xp_rewards_target_check check (
    (trigger_event = 'level_up' and level_no is not null and badge_code is null)
    or (trigger_event = 'badge_awarded' and badge_code is not null and level_no is null)
  )
);

create table if not exists public.xp_streak (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  current_streak_days integer not null default 0 check (current_streak_days >= 0),
  best_streak_days integer not null default 0 check (best_streak_days >= 0),
  last_visit_date date,
  last_streak_award_date date,
  metadata jsonb not null default '{}'::jsonb
);

-- Reward grants are tracked in activity_events (no dedicated V1 table)
create unique index if not exists activity_events_xp_reward_granted_once_idx
  on public.activity_events (user_id, ((payload->>'reward_code')))
  where event_name = 'xp_reward_granted';

-- ---------------------------------------------------------------------------
-- Monotonic level guard
-- ---------------------------------------------------------------------------

create or replace function public.xp_levels_validate_monotonic()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_prev integer;
  v_next integer;
begin
  select xp_required
  into v_prev
  from public.xp_levels
  where level_no < new.level_no
  order by level_no desc
  limit 1;

  select xp_required
  into v_next
  from public.xp_levels
  where level_no > new.level_no
  order by level_no asc
  limit 1;

  if v_prev is not null and new.xp_required <= v_prev then
    raise exception 'xp_levels threshold must be strictly increasing (% <= previous %)', new.xp_required, v_prev;
  end if;

  if v_next is not null and new.xp_required >= v_next then
    raise exception 'xp_levels threshold must be strictly increasing (% >= next %)', new.xp_required, v_next;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_xp_levels_validate_monotonic on public.xp_levels;
create trigger trg_xp_levels_validate_monotonic
before insert or update on public.xp_levels
for each row execute function public.xp_levels_validate_monotonic();

-- ---------------------------------------------------------------------------
-- Updated-at triggers
-- ---------------------------------------------------------------------------

drop trigger if exists trg_xp_actions_updated_at on public.xp_actions;
create trigger trg_xp_actions_updated_at before update on public.xp_actions for each row execute function public.set_updated_at();

drop trigger if exists trg_xp_levels_updated_at on public.xp_levels;
create trigger trg_xp_levels_updated_at before update on public.xp_levels for each row execute function public.set_updated_at();

drop trigger if exists trg_xp_badges_updated_at on public.xp_badges;
create trigger trg_xp_badges_updated_at before update on public.xp_badges for each row execute function public.set_updated_at();

drop trigger if exists trg_xp_ledger_updated_at on public.xp_ledger;
create trigger trg_xp_ledger_updated_at before update on public.xp_ledger for each row execute function public.set_updated_at();

drop trigger if exists trg_xp_user_state_updated_at on public.xp_user_state;
create trigger trg_xp_user_state_updated_at before update on public.xp_user_state for each row execute function public.set_updated_at();

drop trigger if exists trg_xp_rewards_updated_at on public.xp_rewards;
create trigger trg_xp_rewards_updated_at before update on public.xp_rewards for each row execute function public.set_updated_at();

drop trigger if exists trg_xp_streak_updated_at on public.xp_streak;
create trigger trg_xp_streak_updated_at before update on public.xp_streak for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Seed levels (20 validated ranks)
-- ---------------------------------------------------------------------------

insert into public.xp_levels (level_no, rank_name, xp_required, estimated_active_time, icon)
values
  (1, 'Nouvelle', 0, 'Inscription', '🌱'),
  (2, 'Curieuse', 50, '~1 jour', '👀'),
  (3, 'Initiée', 200, '~1 semaine', '🌸'),
  (4, 'Connectée', 450, '~3 semaines', '🔗'),
  (5, 'Stylée', 800, '~5 semaines', '💅'),
  (6, 'Inspirée', 1300, '~2 mois', '✨'),
  (7, 'Fashionista', 2000, '~3 mois', '👗'),
  (8, 'Trendsetter', 2900, '~5 mois', '🔥'),
  (9, 'Curatrice', 4000, '~7 mois', '🎨'),
  (10, 'Influente', 5300, '~9 mois', '💫'),
  (11, 'It Girl', 7000, '~11 mois', '💃'),
  (12, 'Diva', 9000, '~14 mois', '👑'),
  (13, 'Étoile', 11500, '~18 mois', '⭐'),
  (14, 'Muse', 14500, '~2 ans', '🦋'),
  (15, 'Icône', 18000, '~2,5 ans', '💎'),
  (16, 'Papesse', 22000, '~3 ans', '🏛️'),
  (17, 'Visionnaire', 27000, '~3,5 ans', '🔮'),
  (18, 'Légende', 33000, '~4 ans', '🌟'),
  (19, 'Immortelle', 40000, '~5 ans', '♾️'),
  (20, 'Segna Éternelle', 50000, '~6 ans+', '👸')
on conflict (level_no) do update
set rank_name = excluded.rank_name,
    xp_required = excluded.xp_required,
    estimated_active_time = excluded.estimated_active_time,
    icon = excluded.icon;

-- ---------------------------------------------------------------------------
-- Seed XP actions (DB config, no hardcode in app)
-- ---------------------------------------------------------------------------

insert into public.xp_actions (action_code, label, xp_amount, one_time, cap_period, cap_count, description)
values
  ('xp_borrow_item', 'Emprunter une pièce', 10, false, 'none', null, 'Base de l''engagement'),
  ('xp_lend_item', 'Prêter une pièce', 15, false, 'none', null, 'Récompense supply'),
  ('xp_complete_exchange', 'Compléter un échange', 25, false, 'none', null, 'Cycle complet'),
  ('xp_return_on_time', 'Rendre à temps', 5, false, 'none', null, 'Ponctualité'),
  ('xp_return_early', 'Rendre en avance', 8, false, 'none', null, 'Ponctualité premium'),
  ('xp_first_item_lent', 'Première pièce prêtée', 30, true, 'lifetime', 1, 'One-time'),
  ('xp_first_item_borrowed', 'Première pièce empruntée', 20, true, 'lifetime', 1, 'One-time'),
  ('xp_lend_high_value_item', 'Prêter une pièce >300€', 25, false, 'none', null, 'Générosité'),
  ('xp_borrow_new_category', 'Emprunter une nouvelle catégorie', 10, false, 'none', null, 'Exploration'),
  ('xp_lend_5_items_month', 'Prêter 5 pièces/mois', 40, false, 'month', 1, 'Volume mensuel'),
  ('xp_post_look', 'Poster un look Segna', 20, false, 'none', null, 'Feed community'),
  ('xp_post_look_3_plus_items', 'Poster un look 3+ pièces Segna', 35, false, 'none', null, 'Full Segna look'),
  ('xp_review_detailed', 'Avis détaillé >50 caractères', 10, false, 'none', null, 'Qualité feedback'),
  ('xp_review_with_photo', 'Avis avec photo', 15, false, 'none', null, 'Social proof'),
  ('xp_receive_like_on_look', 'Recevoir un j''adore sur look', 3, false, 'day', 10, 'Cap 10/jour'),
  ('xp_answer_member_question', 'Répondre à une question membre', 5, false, 'none', null, 'Entraide'),
  ('xp_vote_curation_poll', 'Voter à un sondage curation', 5, false, 'none', null, 'Participation'),
  ('xp_suggest_item_to_member', 'Suggérer une pièce', 5, false, 'none', null, 'Personal shopper'),
  ('xp_share_look_external', 'Partager look sur Instagram/TikTok', 15, false, 'none', null, 'Contenu externe vérifié'),
  ('xp_referral_active_member', 'Parrainage membre active 1 mois+', 100, false, 'none', null, 'Acquisition'),
  ('xp_attend_segna_event', 'Participer à un évènement Segna', 50, false, 'none', null, 'Engagement IRL'),
  ('xp_cohost_segna_event', 'Co-organiser un évènement Segna', 100, false, 'none', null, 'Ambassadrice'),
  ('xp_welcome_new_member_message', 'Message de bienvenue à une nouvelle membre', 5, false, 'none', null, 'Culture community'),
  ('xp_add_member_favorite', 'Ajouter une membre en favoris', 3, false, 'none', null, 'Crée des liens'),
  ('xp_receive_favorite', 'Recevoir un ajout en favoris', 5, false, 'none', null, 'Profil de qualité'),
  ('xp_item_reaches_5_borrows', 'Pièce atteint 5+ emprunts', 30, false, 'none', null, 'Pièce populaire'),
  ('xp_item_top10_month', 'Pièce top 10 du mois', 50, false, 'month', 1, 'Élite du catalogue'),
  ('xp_update_item_photos', 'Mettre à jour photos pièce', 5, false, 'none', null, 'Entretien catalogue'),
  ('xp_add_item_measurements', 'Ajouter mesures/détails complets', 8, false, 'none', null, 'Qualité de fiche'),
  ('xp_first_item_underrepresented_category', 'Première pièce catégorie sous-représentée', 15, true, 'lifetime', 1, 'Équilibrage'),
  ('xp_five_positive_reviews_streak', '5 avis >= 4⭐ d''affilée', 25, false, 'none', null, 'Constance qualité'),
  ('xp_daily_app_visit', 'Venue sur l''app (streak)', 2, false, 'day', 1, 'Streak de visite'),
  ('xp_onboarding_first_app_open', 'Arrivée sur l''app après onboarding end', 20, true, 'lifetime', 1, 'Bonus onboarding'),
  ('xp_onboarding_completed_100', 'Onboarding 100%', 30, true, 'lifetime', 1, 'Bonus onboarding'),
  ('xp_kyc_validated', 'KYC validé', 50, true, 'lifetime', 1, 'Bonus identité')
on conflict (action_code) do update
set label = excluded.label,
    xp_amount = excluded.xp_amount,
    one_time = excluded.one_time,
    cap_period = excluded.cap_period,
    cap_count = excluded.cap_count,
    description = excluded.description,
    is_active = true;

-- ---------------------------------------------------------------------------
-- XP state helpers + bootstrap
-- ---------------------------------------------------------------------------

create or replace function public.xp_get_level_for_xp(p_total_xp integer)
returns smallint
language sql
stable
set search_path = public
as $$
  select coalesce(
    (
      select level_no
      from public.xp_levels
      where xp_required <= greatest(coalesce(p_total_xp, 0), 0)
      order by xp_required desc
      limit 1
    ),
    1::smallint
  );
$$;

create or replace function public.xp_ensure_user_rows(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    return;
  end if;

  insert into public.xp_user_state (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  insert into public.xp_streak (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;
end;
$$;

create or replace function public.xp_bootstrap_user_rows_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.xp_ensure_user_rows(new.id);
  return new;
end;
$$;

drop trigger if exists trg_xp_bootstrap_user_rows on public.users;
create trigger trg_xp_bootstrap_user_rows
after insert on public.users
for each row execute function public.xp_bootstrap_user_rows_trigger();

insert into public.xp_user_state (user_id)
select u.id
from public.users u
on conflict (user_id) do nothing;

insert into public.xp_streak (user_id)
select u.id
from public.users u
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- Rewards (level_up / badge_awarded)
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
      insert into public.user_wallets (user_id, balance)
      values (p_user_id, 0)
      on conflict (user_id) do nothing;

      update public.user_wallets
      set balance = balance + v_reward.wallet_amount
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

-- ---------------------------------------------------------------------------
-- Award XP action (idempotent + caps + one-time)
-- ---------------------------------------------------------------------------

create or replace function public.xp_award_action(
  p_action_code text,
  p_source_type text default 'system',
  p_source_id text default '',
  p_idempotency_key text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_action public.xp_actions%rowtype;
  v_now timestamptz := timezone('utc', now());
  v_period_start timestamptz;
  v_current_period_count integer := 0;
  v_delta integer := 0;
  v_previous_total integer := 0;
  v_next_total integer := 0;
  v_previous_level smallint := 1;
  v_next_level smallint := 1;
  v_progress numeric(5,2) := 0;
  v_rewards jsonb := '{}'::jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select *
  into v_action
  from public.xp_actions
  where action_code = p_action_code
    and is_active = true;

  if not found then
    raise exception 'Unknown or inactive xp action: %', p_action_code;
  end if;

  perform public.xp_ensure_user_rows(v_uid);

  if v_action.one_time then
    if exists (
      select 1 from public.xp_ledger l
      where l.user_id = v_uid
        and l.action_code = p_action_code
    ) then
      return jsonb_build_object('granted', false, 'reason', 'one_time_already_awarded');
    end if;
  end if;

  if v_action.cap_period <> 'none' and coalesce(v_action.cap_count, 0) > 0 then
    if v_action.cap_period = 'day' then
      v_period_start := date_trunc('day', v_now);
    elsif v_action.cap_period = 'week' then
      v_period_start := date_trunc('week', v_now);
    elsif v_action.cap_period = 'month' then
      v_period_start := date_trunc('month', v_now);
    else
      v_period_start := '1970-01-01'::timestamptz;
    end if;

    select count(*)
    into v_current_period_count
    from public.xp_ledger l
    where l.user_id = v_uid
      and l.action_code = p_action_code
      and l.created_at >= v_period_start;

    if v_current_period_count >= v_action.cap_count then
      return jsonb_build_object('granted', false, 'reason', 'cap_reached');
    end if;
  end if;

  v_delta := v_action.xp_amount;

  begin
    insert into public.xp_ledger (
      user_id,
      action_code,
      award_type,
      xp_delta,
      source_type,
      source_id,
      metadata,
      idempotency_key,
      request_id
    )
    values (
      v_uid,
      p_action_code,
      'action',
      v_delta,
      coalesce(nullif(trim(p_source_type), ''), 'system'),
      coalesce(trim(p_source_id), ''),
      coalesce(p_metadata, '{}'::jsonb),
      nullif(trim(p_idempotency_key), ''),
      p_request_id
    );
  exception
    when unique_violation then
      return jsonb_build_object('granted', false, 'reason', 'duplicate');
  end;

  select total_xp, current_level
  into v_previous_total, v_previous_level
  from public.xp_user_state
  where user_id = v_uid
  for update;

  v_next_total := greatest(v_previous_total + v_delta, 0);
  v_next_level := public.xp_get_level_for_xp(v_next_total);

  if v_next_level < 20 then
    with bounds as (
      select
        l.xp_required as min_xp,
        lead(l.xp_required) over (order by l.level_no) as next_xp
      from public.xp_levels l
      where l.level_no = v_next_level
    )
    select
      case
        when b.next_xp is null then 100
        when b.next_xp <= b.min_xp then 100
        else least(100, greatest(0, ((v_next_total - b.min_xp)::numeric / (b.next_xp - b.min_xp)::numeric) * 100))
      end
    into v_progress
    from bounds b;
  else
    v_progress := 100;
  end if;

  update public.xp_user_state
  set
    total_xp = v_next_total,
    current_level = v_next_level,
    last_xp_at = v_now,
    level_progress_percent = round(v_progress, 2)
  where user_id = v_uid;

  if v_next_level > v_previous_level then
    v_rewards := public.xp_grant_rewards_for_event(
      p_user_id := v_uid,
      p_trigger_event := 'level_up',
      p_level_no := v_next_level,
      p_request_id := p_request_id
    );
  end if;

  perform public.log_activity_event(
    p_event_name => 'xp_action_awarded',
    p_payload => jsonb_build_object(
      'action_code', p_action_code,
      'xp_delta', v_delta,
      'source_type', p_source_type,
      'source_id', p_source_id,
      'previous_total_xp', v_previous_total,
      'next_total_xp', v_next_total,
      'previous_level', v_previous_level,
      'next_level', v_next_level
    ),
    p_request_id => p_request_id
  );

  return jsonb_build_object(
    'granted', true,
    'action_code', p_action_code,
    'xp_delta', v_delta,
    'total_xp', v_next_total,
    'previous_level', v_previous_level,
    'current_level', v_next_level,
    'leveled_up', (v_next_level > v_previous_level),
    'rewards', coalesce(v_rewards, '{}'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Award badge (idempotent one-time + optional XP bonus)
-- ---------------------------------------------------------------------------

create or replace function public.xp_award_badge(
  p_badge_code text,
  p_source_type text default 'system',
  p_source_id text default '',
  p_idempotency_key text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_badge public.xp_badges%rowtype;
  v_previous_total integer := 0;
  v_next_total integer := 0;
  v_previous_level smallint := 1;
  v_next_level smallint := 1;
  v_progress numeric(5,2) := 0;
  v_rewards jsonb := '{}'::jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select *
  into v_badge
  from public.xp_badges
  where badge_code = p_badge_code
    and is_active = true;

  if not found then
    raise exception 'Unknown or inactive xp badge: %', p_badge_code;
  end if;

  perform public.xp_ensure_user_rows(v_uid);

  begin
    insert into public.xp_user_badges (user_id, badge_code, source_type, source_id, metadata)
    values (
      v_uid,
      p_badge_code,
      coalesce(nullif(trim(p_source_type), ''), 'system'),
      coalesce(trim(p_source_id), ''),
      coalesce(p_metadata, '{}'::jsonb)
    );
  exception
    when unique_violation then
      return jsonb_build_object('granted', false, 'reason', 'badge_already_awarded');
  end;

  select total_xp, current_level
  into v_previous_total, v_previous_level
  from public.xp_user_state
  where user_id = v_uid
  for update;

  v_next_total := greatest(v_previous_total + v_badge.xp_bonus, 0);
  v_next_level := public.xp_get_level_for_xp(v_next_total);

  if v_next_level < 20 then
    with bounds as (
      select
        l.xp_required as min_xp,
        lead(l.xp_required) over (order by l.level_no) as next_xp
      from public.xp_levels l
      where l.level_no = v_next_level
    )
    select
      case
        when b.next_xp is null then 100
        when b.next_xp <= b.min_xp then 100
        else least(100, greatest(0, ((v_next_total - b.min_xp)::numeric / (b.next_xp - b.min_xp)::numeric) * 100))
      end
    into v_progress
    from bounds b;
  else
    v_progress := 100;
  end if;

  insert into public.xp_ledger (
    user_id,
    badge_code,
    award_type,
    xp_delta,
    source_type,
    source_id,
    metadata,
    idempotency_key,
    request_id
  )
  values (
    v_uid,
    p_badge_code,
    'badge_awarded',
    v_badge.xp_bonus,
    coalesce(nullif(trim(p_source_type), ''), 'system'),
    coalesce(trim(p_source_id), ''),
    coalesce(p_metadata, '{}'::jsonb),
    nullif(trim(p_idempotency_key), ''),
    p_request_id
  );

  update public.xp_user_state
  set
    total_xp = v_next_total,
    current_level = v_next_level,
    last_xp_at = timezone('utc', now()),
    level_progress_percent = round(v_progress, 2)
  where user_id = v_uid;

  v_rewards := public.xp_grant_rewards_for_event(
    p_user_id := v_uid,
    p_trigger_event := 'badge_awarded',
    p_badge_code := p_badge_code,
    p_request_id := p_request_id
  );

  if v_next_level > v_previous_level then
    v_rewards := coalesce(v_rewards, '{}'::jsonb) || jsonb_build_object(
      'level_up_rewards',
      public.xp_grant_rewards_for_event(
        p_user_id := v_uid,
        p_trigger_event := 'level_up',
        p_level_no := v_next_level,
        p_request_id := p_request_id
      )
    );
  end if;

  perform public.log_activity_event(
    p_event_name => 'xp_badge_awarded',
    p_payload => jsonb_build_object(
      'badge_code', p_badge_code,
      'xp_bonus', v_badge.xp_bonus,
      'previous_total_xp', v_previous_total,
      'next_total_xp', v_next_total,
      'previous_level', v_previous_level,
      'next_level', v_next_level
    ),
    p_request_id => p_request_id
  );

  return jsonb_build_object(
    'granted', true,
    'badge_code', p_badge_code,
    'xp_delta', v_badge.xp_bonus,
    'total_xp', v_next_total,
    'current_level', v_next_level,
    'leveled_up', (v_next_level > v_previous_level),
    'rewards', coalesce(v_rewards, '{}'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Daily app visit streak (simplified V1)
-- ---------------------------------------------------------------------------

create or replace function public.xp_touch_daily_visit(
  p_source_id text default '',
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_today date := timezone('utc', now())::date;
  v_yesterday date := (timezone('utc', now())::date - 1);
  v_current integer := 0;
  v_best integer := 0;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  perform public.xp_ensure_user_rows(v_uid);

  select current_streak_days, best_streak_days
  into v_current, v_best
  from public.xp_streak
  where user_id = v_uid
  for update;

  if exists (
    select 1 from public.xp_streak s
    where s.user_id = v_uid and s.last_visit_date = v_today
  ) then
    return jsonb_build_object('touched', true, 'awarded', false, 'current_streak_days', v_current, 'best_streak_days', v_best);
  end if;

  update public.xp_streak
  set
    current_streak_days = case
      when last_visit_date = v_yesterday then current_streak_days + 1
      else 1
    end,
    best_streak_days = greatest(
      best_streak_days,
      case when last_visit_date = v_yesterday then current_streak_days + 1 else 1 end
    ),
    last_visit_date = v_today
  where user_id = v_uid;

  return public.xp_award_action(
    p_action_code := 'xp_daily_app_visit',
    p_source_type := 'streak',
    p_source_id := coalesce(nullif(trim(p_source_id), ''), v_today::text),
    p_idempotency_key := format('xp_daily_app_visit:%s:%s', v_uid::text, v_today::text),
    p_metadata := jsonb_build_object('visit_date', v_today),
    p_request_id := p_request_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS + grants
-- ---------------------------------------------------------------------------

alter table public.xp_actions enable row level security;
alter table public.xp_levels enable row level security;
alter table public.xp_badges enable row level security;
alter table public.xp_user_badges enable row level security;
alter table public.xp_ledger enable row level security;
alter table public.xp_user_state enable row level security;
alter table public.xp_rewards enable row level security;
alter table public.xp_streak enable row level security;

-- Own user data read
drop policy if exists "xp_user_state_select_own" on public.xp_user_state;
create policy "xp_user_state_select_own" on public.xp_user_state
for select to authenticated
using (user_id = auth.uid() or public.xp_is_moderator_or_admin());

drop policy if exists "xp_streak_select_own" on public.xp_streak;
create policy "xp_streak_select_own" on public.xp_streak
for select to authenticated
using (user_id = auth.uid() or public.xp_is_moderator_or_admin());

drop policy if exists "xp_ledger_select_own" on public.xp_ledger;
create policy "xp_ledger_select_own" on public.xp_ledger
for select to authenticated
using (user_id = auth.uid() or public.xp_is_moderator_or_admin());

drop policy if exists "xp_user_badges_select_own" on public.xp_user_badges;
create policy "xp_user_badges_select_own" on public.xp_user_badges
for select to authenticated
using (user_id = auth.uid() or public.xp_is_moderator_or_admin());

-- Config tables readable by authenticated users
drop policy if exists "xp_actions_select_all_auth" on public.xp_actions;
create policy "xp_actions_select_all_auth" on public.xp_actions
for select to authenticated
using (true);

drop policy if exists "xp_levels_select_all_auth" on public.xp_levels;
create policy "xp_levels_select_all_auth" on public.xp_levels
for select to authenticated
using (true);

drop policy if exists "xp_badges_select_all_auth" on public.xp_badges;
create policy "xp_badges_select_all_auth" on public.xp_badges
for select to authenticated
using (true);

drop policy if exists "xp_rewards_select_all_auth" on public.xp_rewards;
create policy "xp_rewards_select_all_auth" on public.xp_rewards
for select to authenticated
using (true);

-- Admin full control + corrections
drop policy if exists "xp_actions_admin_all" on public.xp_actions;
create policy "xp_actions_admin_all" on public.xp_actions
for all to authenticated
using (public.xp_is_admin())
with check (public.xp_is_admin());

drop policy if exists "xp_levels_admin_all" on public.xp_levels;
create policy "xp_levels_admin_all" on public.xp_levels
for all to authenticated
using (public.xp_is_admin())
with check (public.xp_is_admin());

drop policy if exists "xp_badges_admin_all" on public.xp_badges;
create policy "xp_badges_admin_all" on public.xp_badges
for all to authenticated
using (public.xp_is_admin())
with check (public.xp_is_admin());

drop policy if exists "xp_rewards_admin_all" on public.xp_rewards;
create policy "xp_rewards_admin_all" on public.xp_rewards
for all to authenticated
using (public.xp_is_admin())
with check (public.xp_is_admin());

drop policy if exists "xp_ledger_admin_all" on public.xp_ledger;
create policy "xp_ledger_admin_all" on public.xp_ledger
for all to authenticated
using (public.xp_is_admin())
with check (public.xp_is_admin());

drop policy if exists "xp_user_state_admin_all" on public.xp_user_state;
create policy "xp_user_state_admin_all" on public.xp_user_state
for all to authenticated
using (public.xp_is_admin())
with check (public.xp_is_admin());

drop policy if exists "xp_streak_admin_all" on public.xp_streak;
create policy "xp_streak_admin_all" on public.xp_streak
for all to authenticated
using (public.xp_is_admin())
with check (public.xp_is_admin());

drop policy if exists "xp_user_badges_admin_all" on public.xp_user_badges;
create policy "xp_user_badges_admin_all" on public.xp_user_badges
for all to authenticated
using (public.xp_is_admin())
with check (public.xp_is_admin());

grant select on public.xp_actions, public.xp_levels, public.xp_badges, public.xp_rewards to authenticated;
grant select on public.xp_user_state, public.xp_streak, public.xp_ledger, public.xp_user_badges to authenticated;

grant execute on function public.xp_award_action(text, text, text, text, jsonb, uuid) to authenticated;
grant execute on function public.xp_award_badge(text, text, text, text, jsonb, uuid) to authenticated;
grant execute on function public.xp_touch_daily_visit(text, uuid) to authenticated;
grant execute on function public.xp_get_level_for_xp(integer) to authenticated;
