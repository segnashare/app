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
  v_now timestamptz := timezone('utc', now());
  v_today date := v_now::date;
  v_yesterday date := (v_today - 1);
  v_current integer := 0;
  v_best integer := 0;
  v_next_streak integer := 0;
  v_bonus integer := 0;
  v_previous_total integer := 0;
  v_next_total integer := 0;
  v_previous_level smallint := 1;
  v_next_level smallint := 1;
  v_progress numeric(5,2) := 0;
  v_rewards jsonb := '{}'::jsonb;
  v_effective_source_id text;
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
    select 1
    from public.xp_streak s
    where s.user_id = v_uid
      and s.last_visit_date = v_today
  ) then
    return jsonb_build_object(
      'touched', true,
      'awarded', false,
      'reason', 'already_touched_today',
      'current_streak_days', v_current,
      'best_streak_days', v_best
    );
  end if;

  v_next_streak := case
    when (select last_visit_date from public.xp_streak where user_id = v_uid) = v_yesterday then v_current + 1
    else 1
  end;

  update public.xp_streak
  set
    current_streak_days = v_next_streak,
    best_streak_days = greatest(best_streak_days, v_next_streak),
    last_visit_date = v_today
  where user_id = v_uid;

  -- Milestones (non-cumulative): award only milestone reached today.
  v_bonus := case v_next_streak
    when 2 then 2
    when 3 then 3
    when 4 then 5
    when 5 then 10
    when 6 then 20
    when 7 then 35
    when 8 then 55
    else case when v_next_streak >= 9 then 80 else 0 end
  end;

  if v_bonus <= 0 then
    return jsonb_build_object(
      'touched', true,
      'awarded', false,
      'reason', 'no_milestone_today',
      'current_streak_days', v_next_streak,
      'best_streak_days', greatest(v_best, v_next_streak)
    );
  end if;

  v_effective_source_id := coalesce(nullif(trim(p_source_id), ''), v_today::text);

  begin
    insert into public.xp_ledger (
      user_id,
      award_type,
      xp_delta,
      source_type,
      source_id,
      reason,
      metadata,
      idempotency_key,
      request_id
    )
    values (
      v_uid,
      'system_bonus',
      v_bonus,
      'streak',
      v_effective_source_id,
      format('streak_day_%s_bonus', v_next_streak),
      jsonb_build_object(
        'visit_date', v_today,
        'streak_day', v_next_streak,
        'milestone_bonus', v_bonus,
        'mode', 'non_cumulative_milestones'
      ),
      format('xp_streak_bonus:%s:%s', v_uid::text, v_today::text),
      p_request_id
    );
  exception
    when unique_violation then
      return jsonb_build_object(
        'touched', true,
        'awarded', false,
        'reason', 'duplicate',
        'current_streak_days', v_next_streak,
        'best_streak_days', greatest(v_best, v_next_streak)
      );
  end;

  select total_xp, current_level
  into v_previous_total, v_previous_level
  from public.xp_user_state
  where user_id = v_uid
  for update;

  v_next_total := greatest(v_previous_total + v_bonus, 0);
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
    p_event_name => 'xp_streak_bonus_awarded',
    p_payload => jsonb_build_object(
      'streak_day', v_next_streak,
      'xp_delta', v_bonus,
      'previous_total_xp', v_previous_total,
      'next_total_xp', v_next_total,
      'previous_level', v_previous_level,
      'next_level', v_next_level
    ),
    p_request_id => p_request_id
  );

  return jsonb_build_object(
    'touched', true,
    'awarded', true,
    'xp_delta', v_bonus,
    'streak_day', v_next_streak,
    'current_streak_days', v_next_streak,
    'best_streak_days', greatest(v_best, v_next_streak),
    'total_xp', v_next_total,
    'current_level', v_next_level,
    'leveled_up', (v_next_level > v_previous_level),
    'rewards', coalesce(v_rewards, '{}'::jsonb)
  );
end;
$$;
