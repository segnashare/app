alter table public.xp_user_badges
  add column if not exists current_value numeric not null default 0,
  add column if not exists target_value numeric not null default 1,
  add column if not exists progress_percent numeric(5,2) not null default 0,
  add column if not exists is_completed boolean not null default false,
  add column if not exists completed_at timestamptz,
  add column if not exists last_progress_at timestamptz;

update public.xp_user_badges ub
set
  target_value = greatest(
    coalesce(public.xp_safe_numeric((b.metadata->>'threshold')::text), 1),
    1
  ),
  current_value = greatest(
    ub.current_value,
    case when ub.is_completed then ub.target_value else ub.current_value end
  ),
  progress_percent = case
    when greatest(coalesce(public.xp_safe_numeric((b.metadata->>'threshold')::text), 1), 1) <= 0 then 0
    else least(
      100,
      round(
        (least(
          greatest(ub.current_value, case when ub.is_completed then ub.target_value else ub.current_value end),
          greatest(coalesce(public.xp_safe_numeric((b.metadata->>'threshold')::text), 1), 1)
        ) / greatest(coalesce(public.xp_safe_numeric((b.metadata->>'threshold')::text), 1), 1)) * 100,
        2
      )
    )
  end,
  is_completed = coalesce(ub.is_completed, false),
  completed_at = case when ub.is_completed and ub.completed_at is null then ub.created_at else ub.completed_at end
from public.xp_badges b
where b.badge_code = ub.badge_code;

create table if not exists public.xp_achievements (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  badge_code text not null references public.xp_badges(badge_code) on delete cascade,
  delta numeric not null check (delta > 0),
  source_type text not null default 'system',
  source_id text not null default '',
  idempotency_key text unique,
  request_id uuid,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists xp_achievements_user_badge_idx
  on public.xp_achievements (user_id, badge_code, created_at desc);

drop trigger if exists trg_xp_achievements_updated_at on public.xp_achievements;
create trigger trg_xp_achievements_updated_at
before update on public.xp_achievements
for each row execute function public.set_updated_at();

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
  v_row public.xp_user_badges%rowtype;
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

  insert into public.xp_user_badges (
    user_id,
    badge_code,
    source_type,
    source_id,
    metadata,
    current_value,
    target_value,
    progress_percent,
    is_completed,
    completed_at,
    last_progress_at
  )
  values (
    v_uid,
    p_badge_code,
    coalesce(nullif(trim(p_source_type), ''), 'system'),
    coalesce(trim(p_source_id), ''),
    coalesce(p_metadata, '{}'::jsonb),
    greatest(coalesce(public.xp_safe_numeric((v_badge.metadata->>'threshold')::text), 1), 1),
    greatest(coalesce(public.xp_safe_numeric((v_badge.metadata->>'threshold')::text), 1), 1),
    0,
    false,
    null,
    timezone('utc', now())
  )
  on conflict (user_id, badge_code) do nothing;

  select *
  into v_row
  from public.xp_user_badges
  where user_id = v_uid
    and badge_code = p_badge_code
  for update;

  if v_row.is_completed then
    return jsonb_build_object('granted', false, 'reason', 'badge_already_awarded');
  end if;

  update public.xp_user_badges
  set
    source_type = coalesce(nullif(trim(p_source_type), ''), source_type),
    source_id = coalesce(nullif(trim(p_source_id), ''), source_id),
    metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
    current_value = greatest(current_value, target_value),
    progress_percent = 100,
    is_completed = true,
    completed_at = coalesce(completed_at, timezone('utc', now())),
    last_progress_at = timezone('utc', now())
  where id = v_row.id;

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

  begin
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
  exception
    when unique_violation then
      return jsonb_build_object('granted', false, 'reason', 'duplicate');
  end;

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

create or replace function public.xp_record_badge_achievement(
  p_badge_code text,
  p_delta numeric,
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
  v_target numeric := 1;
  v_current numeric := 0;
  v_progress numeric(5,2) := 0;
  v_completed boolean := false;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if coalesce(p_delta, 0) <= 0 then
    raise exception 'p_delta must be > 0';
  end if;

  select *
  into v_badge
  from public.xp_badges
  where badge_code = p_badge_code
    and is_active = true;

  if not found then
    raise exception 'Unknown or inactive xp badge: %', p_badge_code;
  end if;

  v_target := greatest(coalesce(public.xp_safe_numeric((v_badge.metadata->>'threshold')::text), 1), 1);

  begin
    insert into public.xp_achievements (
      user_id,
      badge_code,
      delta,
      source_type,
      source_id,
      idempotency_key,
      request_id,
      metadata
    )
    values (
      v_uid,
      p_badge_code,
      p_delta,
      coalesce(nullif(trim(p_source_type), ''), 'system'),
      coalesce(trim(p_source_id), ''),
      nullif(trim(p_idempotency_key), ''),
      p_request_id,
      coalesce(p_metadata, '{}'::jsonb)
    );
  exception
    when unique_violation then
      return jsonb_build_object('recorded', false, 'reason', 'duplicate');
  end;

  insert into public.xp_user_badges (
    user_id,
    badge_code,
    source_type,
    source_id,
    metadata,
    current_value,
    target_value,
    progress_percent,
    is_completed,
    last_progress_at
  )
  values (
    v_uid,
    p_badge_code,
    coalesce(nullif(trim(p_source_type), ''), 'system'),
    coalesce(trim(p_source_id), ''),
    coalesce(p_metadata, '{}'::jsonb),
    p_delta,
    v_target,
    round(least(100, (least(p_delta, v_target) / v_target) * 100), 2),
    false,
    timezone('utc', now())
  )
  on conflict (user_id, badge_code) do update
  set
    current_value = least(xp_user_badges.target_value, xp_user_badges.current_value + excluded.current_value),
    target_value = excluded.target_value,
    progress_percent = round(
      least(
        100,
        (least(xp_user_badges.target_value, xp_user_badges.current_value + excluded.current_value) / excluded.target_value) * 100
      ),
      2
    ),
    source_type = excluded.source_type,
    source_id = excluded.source_id,
    metadata = coalesce(xp_user_badges.metadata, '{}'::jsonb) || excluded.metadata,
    last_progress_at = timezone('utc', now());

  select
    current_value,
    progress_percent,
    is_completed
  into
    v_current,
    v_progress,
    v_completed
  from public.xp_user_badges
  where user_id = v_uid
    and badge_code = p_badge_code
  for update;

  if not v_completed and v_current >= v_target then
    perform public.xp_award_badge(
      p_badge_code := p_badge_code,
      p_source_type := 'achievement',
      p_source_id := coalesce(trim(p_source_id), ''),
      p_idempotency_key := format('xp_badge_unlock:%s:%s', v_uid::text, p_badge_code),
      p_metadata := jsonb_build_object('trigger', 'xp_record_badge_achievement'),
      p_request_id := p_request_id
    );
    v_completed := true;
    v_progress := 100;
    v_current := v_target;
  end if;

  return jsonb_build_object(
    'recorded', true,
    'badge_code', p_badge_code,
    'current_value', v_current,
    'target_value', v_target,
    'progress_percent', v_progress,
    'is_completed', v_completed
  );
end;
$$;

create or replace function public.xp_get_badges_progress()
returns table (
  badge_code text,
  label text,
  description text,
  icon text,
  current_value numeric,
  target_value numeric,
  progress_percent numeric,
  is_completed boolean,
  remaining_value numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with src as (
    select
      b.badge_code,
      b.label,
      b.description,
      b.icon,
      greatest(coalesce(public.xp_safe_numeric((b.metadata->>'threshold')::text), 1), 1) as target_value
    from public.xp_badges b
    where b.is_active = true
  ),
  ach as (
    select
      a.badge_code,
      sum(a.delta) as achieved
    from public.xp_achievements a
    where a.user_id = auth.uid()
    group by a.badge_code
  ),
  ub as (
    select *
    from public.xp_user_badges
    where user_id = auth.uid()
  )
  select
    s.badge_code,
    s.label,
    s.description,
    s.icon,
    least(
      s.target_value,
      greatest(
        coalesce(ub.current_value, 0),
        coalesce(ach.achieved, 0)
      )
    ) as current_value,
    s.target_value,
    round(
      least(
        100,
        (
          least(
            s.target_value,
            greatest(coalesce(ub.current_value, 0), coalesce(ach.achieved, 0))
          ) / s.target_value
        ) * 100
      ),
      2
    ) as progress_percent,
    coalesce(ub.is_completed, false) as is_completed,
    greatest(
      s.target_value - least(
        s.target_value,
        greatest(coalesce(ub.current_value, 0), coalesce(ach.achieved, 0))
      ),
      0
    ) as remaining_value
  from src s
  left join ub on ub.badge_code = s.badge_code
  left join ach on ach.badge_code = s.badge_code
  order by s.badge_code;
$$;

alter table public.xp_achievements enable row level security;

drop policy if exists "xp_achievements_select_own" on public.xp_achievements;
create policy "xp_achievements_select_own" on public.xp_achievements
for select to authenticated
using (user_id = auth.uid() or public.xp_is_moderator_or_admin());

drop policy if exists "xp_achievements_admin_all" on public.xp_achievements;
create policy "xp_achievements_admin_all" on public.xp_achievements
for all to authenticated
using (public.xp_is_admin())
with check (public.xp_is_admin());

grant select on public.xp_achievements to authenticated;
grant execute on function public.xp_record_badge_achievement(text, numeric, text, text, text, jsonb, uuid) to authenticated;
grant execute on function public.xp_get_badges_progress() to authenticated;
