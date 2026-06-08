-- Économie dynamique Segna : double valorisation (remplacement figée + échange dynamique).

-- ---------------------------------------------------------------------------
-- items : valeur de remplacement + gel pricing dynamique
-- ---------------------------------------------------------------------------
alter table public.items
  add column if not exists replacement_value_points integer,
  add column if not exists exchange_pricing_frozen boolean not null default false;

comment on column public.items.replacement_value_points is
  'Valeur de remplacement (garantie prêteuse). Figée à l''intake ; modifiable BO uniquement.';
comment on column public.items.exchange_pricing_frozen is
  'Si true, le moteur demande ne modifie pas price_points (valeur d''échange).';

update public.items
set replacement_value_points = price_points
where replacement_value_points is null
  and price_points is not null
  and price_points > 0;

-- Garantie >= prix facial emprunteur (quand les deux sont renseignés).
alter table public.items
  drop constraint if exists items_replacement_gte_exchange_check;
alter table public.items
  add constraint items_replacement_gte_exchange_check
  check (
    replacement_value_points is null
    or price_points is null
    or replacement_value_points >= price_points
  );

-- ---------------------------------------------------------------------------
-- item_price_history : type + source + metadata
-- ---------------------------------------------------------------------------
alter table public.item_price_history
  add column if not exists price_type text not null default 'exchange',
  add column if not exists source text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.item_price_history
  drop constraint if exists item_price_history_price_type_check;
alter table public.item_price_history
  add constraint item_price_history_price_type_check
  check (price_type in ('exchange', 'replacement'));

-- ---------------------------------------------------------------------------
-- Configuration moteur (singleton id=1)
-- ---------------------------------------------------------------------------
create table if not exists public.economy_exchange_pricing_config (
  id smallint primary key default 1 check (id = 1),
  window_days integer not null default 28 check (window_days between 1 and 365),
  weight_likes numeric not null default 0.5 check (weight_likes >= 0),
  weight_cart_adds numeric not null default 1.0 check (weight_cart_adds >= 0),
  weight_borrows numeric not null default 3.0 check (weight_borrows >= 0),
  min_signals_before_adjust integer not null default 3 check (min_signals_before_adjust >= 0),
  max_delta_ratio numeric not null default 0.10 check (max_delta_ratio >= 0 and max_delta_ratio <= 1),
  floor_ratio numeric not null default 0.50 check (floor_ratio >= 0 and floor_ratio <= 2),
  ceiling_ratio numeric not null default 1.50 check (ceiling_ratio >= 0.5 and ceiling_ratio <= 5),
  demand_k numeric not null default 0.15 check (demand_k >= 0 and demand_k <= 2),
  shadow_mode boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.economy_exchange_pricing_config (id)
values (1)
on conflict (id) do nothing;

comment on table public.economy_exchange_pricing_config is
  'Paramètres du moteur de recalibrage de la valeur d''échange (price_points).';

-- ---------------------------------------------------------------------------
-- Métriques demande journalières
-- ---------------------------------------------------------------------------
create table if not exists public.item_demand_metrics_daily (
  day date not null,
  item_id uuid not null references public.items (id) on delete cascade,
  likes_count integer not null default 0 check (likes_count >= 0),
  cart_add_count integer not null default 0 check (cart_add_count >= 0),
  borrow_confirmed_count integer not null default 0 check (borrow_confirmed_count >= 0),
  demand_score numeric not null default 0,
  demand_index numeric,
  updated_at timestamptz not null default now(),
  primary key (day, item_id)
);

create index if not exists item_demand_metrics_daily_item_day_idx
  on public.item_demand_metrics_daily (item_id, day desc);

comment on table public.item_demand_metrics_daily is
  'Signaux demande agrégés (likes, panier, emprunts) sur fenêtre glissante.';

-- ---------------------------------------------------------------------------
-- RPC : agrégation demande
-- ---------------------------------------------------------------------------
create or replace function public.aggregate_item_demand_metrics(p_day date default current_date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg public.economy_exchange_pricing_config%rowtype;
  v_window_start timestamptz;
  v_items_processed integer := 0;
begin
  select * into v_cfg from public.economy_exchange_pricing_config where id = 1;
  if not found then
    raise exception 'economy_exchange_pricing_config missing';
  end if;

  v_window_start := (p_day - (v_cfg.window_days - 1))::timestamptz;

  with eligible_items as (
    select i.id as item_id
    from public.items i
    join public.item_intake ii on ii.item_id = i.id
    where i.deleted_at is null
      and ii.listing_stage = 'validated'
      and i.replacement_value_points is not null
      and i.replacement_value_points > 0
  ),
  likes as (
    select f.item_id, count(*)::integer as cnt
    from public.item_favorites f
    join eligible_items e on e.item_id = f.item_id
    where f.deleted_at is null
      and f.created_at >= v_window_start
      and f.created_at < (p_day + 1)::timestamptz
    group by f.item_id
  ),
  cart_adds as (
    select ci.item_id, count(distinct ci.cart_id)::integer as cnt
    from public.cart_items ci
    join eligible_items e on e.item_id = ci.item_id
    where ci.created_at >= v_window_start
      and ci.created_at < (p_day + 1)::timestamptz
    group by ci.item_id
  ),
  borrows as (
    select ci.item_id, count(*)::integer as cnt
    from public.cart_items ci
    join public.carts c on c.id = ci.cart_id
    join eligible_items e on e.item_id = ci.item_id
    where ci.status = 'verified'
      and c.status in ('confirmed', 'archived')
      and c.deleted_at is null
      and ci.created_at >= v_window_start
      and ci.created_at < (p_day + 1)::timestamptz
    group by ci.item_id
  ),
  raw_scores as (
    select
      e.item_id,
      coalesce(l.cnt, 0) as likes_count,
      coalesce(ca.cnt, 0) as cart_add_count,
      coalesce(b.cnt, 0) as borrow_confirmed_count,
      (
        coalesce(l.cnt, 0) * v_cfg.weight_likes
        + coalesce(ca.cnt, 0) * v_cfg.weight_cart_adds
        + coalesce(b.cnt, 0) * v_cfg.weight_borrows
      )::numeric as demand_score,
      i.item_category_id,
      i.replacement_value_points
    from eligible_items e
    join public.items i on i.id = e.item_id
    left join likes l on l.item_id = e.item_id
    left join cart_adds ca on ca.item_id = e.item_id
    left join borrows b on b.item_id = e.item_id
  ),
  segment_medians as (
    select
      item_category_id,
      (floor(coalesce(replacement_value_points, 0) / 50.0) * 50)::integer as replacement_bucket,
      percentile_cont(0.5) within group (order by demand_score) as segment_median
    from raw_scores
    group by item_category_id, (floor(coalesce(replacement_value_points, 0) / 50.0) * 50)::integer
  )
  insert into public.item_demand_metrics_daily as d (
    day,
    item_id,
    likes_count,
    cart_add_count,
    borrow_confirmed_count,
    demand_score,
    demand_index,
    updated_at
  )
  select
    p_day,
    r.item_id,
    r.likes_count,
    r.cart_add_count,
    r.borrow_confirmed_count,
    r.demand_score,
    case
      when r.demand_score <= 0 then 0
      else r.demand_score / greatest(coalesce(sm.segment_median, 1), 1)
    end as demand_index,
    now()
  from raw_scores r
  left join segment_medians sm
    on sm.item_category_id is not distinct from r.item_category_id
   and sm.replacement_bucket = (floor(coalesce(r.replacement_value_points, 0) / 50.0) * 50)::integer
  on conflict (day, item_id) do update
  set likes_count = excluded.likes_count,
      cart_add_count = excluded.cart_add_count,
      borrow_confirmed_count = excluded.borrow_confirmed_count,
      demand_score = excluded.demand_score,
      demand_index = excluded.demand_index,
      updated_at = excluded.updated_at;

  get diagnostics v_items_processed = row_count;
  return jsonb_build_object(
    'day', p_day,
    'items_processed', v_items_processed,
    'window_days', v_cfg.window_days
  );
end;
$$;

comment on function public.aggregate_item_demand_metrics(date) is
  'Agrège likes / ajouts panier / emprunts confirmés sur la fenêtre configurée.';

-- ---------------------------------------------------------------------------
-- RPC : recalibrage valeur d''échange
-- ---------------------------------------------------------------------------
create or replace function public.recalibrate_exchange_prices(p_day date default current_date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg public.economy_exchange_pricing_config%rowtype;
  v_adjusted integer := 0;
  v_skipped integer := 0;
  v_shadow integer := 0;
  rec record;
  v_old integer;
  v_new integer;
  v_target numeric;
  v_replacement integer;
  v_signals integer;
  v_demand_index numeric;
  v_delta_max numeric;
  v_floor integer;
  v_ceiling integer;
begin
  select * into v_cfg from public.economy_exchange_pricing_config where id = 1;
  if not found then
    raise exception 'economy_exchange_pricing_config missing';
  end if;

  if exists (
    select 1
    from public.item_price_history h
    where h.source = 'demand_engine'
      and h.price_type = 'exchange'
      and h.created_at::date = p_day
  ) then
    return jsonb_build_object(
      'day', p_day,
      'adjusted', 0,
      'skipped', 0,
      'shadow_would_adjust', 0,
      'shadow_mode', v_cfg.shadow_mode,
      'already_ran', true
    );
  end if;

  perform public.aggregate_item_demand_metrics(p_day);

  for rec in
    select
      i.id as item_id,
      i.price_points,
      i.replacement_value_points,
      coalesce(m.demand_index, 0) as demand_index,
      coalesce(m.demand_score, 0) as demand_score,
      coalesce(m.likes_count, 0) + coalesce(m.cart_add_count, 0) + coalesce(m.borrow_confirmed_count, 0) as signal_count
    from public.items i
    join public.item_intake ii on ii.item_id = i.id
    left join public.item_demand_metrics_daily m
      on m.item_id = i.id and m.day = p_day
    where i.deleted_at is null
      and i.status = 'available'
      and ii.listing_stage = 'validated'
      and i.exchange_pricing_frozen = false
      and i.replacement_value_points is not null
      and i.replacement_value_points > 0
  loop
    v_replacement := rec.replacement_value_points;
    v_old := coalesce(rec.price_points, v_replacement);
    v_signals := rec.signal_count;
    v_demand_index := coalesce(rec.demand_index, 0);

    if v_signals < v_cfg.min_signals_before_adjust then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_floor := greatest(1, floor(v_replacement * v_cfg.floor_ratio)::integer);
    v_ceiling := greatest(v_floor, ceil(v_replacement * v_cfg.ceiling_ratio)::integer);

    v_target := v_replacement * (1 + v_cfg.demand_k * (v_demand_index - 1));
    v_target := greatest(v_floor::numeric, least(v_ceiling::numeric, v_target));

    v_delta_max := v_old * v_cfg.max_delta_ratio;
    v_new := round(v_target)::integer;
    v_new := greatest(v_floor, least(v_ceiling, v_new));
    v_new := greatest(v_floor, least(v_ceiling, round(greatest(v_old - v_delta_max, least(v_old + v_delta_max, v_new)))::integer));

    if v_new = v_old then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if v_cfg.shadow_mode then
      v_shadow := v_shadow + 1;
      continue;
    end if;

    update public.items
    set price_points = v_new
    where id = rec.item_id;

    insert into public.item_price_history (
      item_id,
      old_price_points,
      new_price_points,
      reason,
      price_type,
      source,
      metadata
    )
    values (
      rec.item_id,
      v_old,
      v_new,
      'demand_engine_recalibration',
      'exchange',
      'demand_engine',
      jsonb_build_object(
        'day', p_day,
        'demand_index', v_demand_index,
        'demand_score', rec.demand_score,
        'signal_count', v_signals,
        'replacement_value_points', v_replacement,
        'target_exchange', round(v_target)::integer
      )
    );

    v_adjusted := v_adjusted + 1;
  end loop;

  return jsonb_build_object(
    'day', p_day,
    'adjusted', v_adjusted,
    'skipped', v_skipped,
    'shadow_would_adjust', v_shadow,
    'shadow_mode', v_cfg.shadow_mode
  );
end;
$$;

comment on function public.recalibrate_exchange_prices(date) is
  'Recalibre price_points selon demand_index ; respecte bornes et max delta par cycle.';

-- ---------------------------------------------------------------------------
-- RPC : paniers actifs touchés par changement de prix
-- ---------------------------------------------------------------------------
create or replace function public.list_active_carts_for_exchange_price_changes(
  p_changes jsonb
)
returns table (
  cart_id uuid,
  user_id uuid,
  item_id uuid,
  item_title text,
  old_price_points integer,
  new_price_points integer
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  elem jsonb;
begin
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' then
    return;
  end if;

  for elem in select value from jsonb_array_elements(p_changes)
  loop
    return query
    select
      c.id,
      c.user_id,
      i.id,
      i.title,
      (elem->>'old_price_points')::integer,
      (elem->>'new_price_points')::integer
    from public.items i
    join public.cart_items ci on ci.item_id = i.id
    join public.carts c on c.id = ci.cart_id
    where i.id = (elem->>'item_id')::uuid
      and c.status = 'active'
      and c.deleted_at is null;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC : compensation perte (base = replacement_value_points)
-- ---------------------------------------------------------------------------
create or replace function public.resolve_item_loss_compensation(
  p_loss_id uuid,
  p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loss public.item_losses%rowtype;
  v_replacement integer;
  v_compensation integer;
begin
  select * into v_loss from public.item_losses where id = p_loss_id for update;
  if not found then
    raise exception 'item_loss_not_found';
  end if;

  if v_loss.status not in ('open', 'in_review') then
    raise exception 'item_loss_not_actionable';
  end if;

  select replacement_value_points, coalesce(replacement_value_points, price_points, 0)
  into v_replacement, v_compensation
  from public.items
  where id = v_loss.item_id;

  if v_compensation is null or v_compensation <= 0 then
    raise exception 'replacement_value_missing';
  end if;

  update public.item_losses
  set status = 'resolved',
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'compensation_points', v_compensation,
        'replacement_value_points', v_replacement,
        'resolved_at', now(),
        'resolved_by', p_actor_user_id
      ),
      updated_at = now()
  where id = p_loss_id;

  return jsonb_build_object(
    'loss_id', p_loss_id,
    'item_id', v_loss.item_id,
    'compensation_points', v_compensation,
    'replacement_value_points', v_replacement
  );
end;
$$;

comment on function public.resolve_item_loss_compensation(uuid, uuid) is
  'Clôture une perte avec compensation = replacement_value_points (garantie prêteuse).';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.economy_exchange_pricing_config enable row level security;
alter table public.item_demand_metrics_daily enable row level security;

revoke all on table public.economy_exchange_pricing_config from anon, authenticated;
revoke all on table public.item_demand_metrics_daily from anon, authenticated;
grant select, insert, update, delete on table public.economy_exchange_pricing_config to service_role;
grant select, insert, update, delete on table public.item_demand_metrics_daily to service_role;

revoke all on function public.aggregate_item_demand_metrics(date) from public;
revoke all on function public.recalibrate_exchange_prices(date) from public;
revoke all on function public.list_active_carts_for_exchange_price_changes(jsonb) from public;
revoke all on function public.resolve_item_loss_compensation(uuid, uuid) from public;

grant execute on function public.aggregate_item_demand_metrics(date) to service_role;
grant execute on function public.recalibrate_exchange_prices(date) to service_role;
grant execute on function public.list_active_carts_for_exchange_price_changes(jsonb) to service_role;
grant execute on function public.resolve_item_loss_compensation(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Crons : agrégation quotidienne + recalibrage hebdomadaire (lundi 06:00 UTC)
-- ---------------------------------------------------------------------------
do $do$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'economy_demand_metrics_daily' limit 1;
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
  perform cron.schedule(
    'economy_demand_metrics_daily',
    '30 5 * * *',
    $$select public.aggregate_item_demand_metrics(current_date);$$
  );

  select jobid into v_job_id from cron.job where jobname = 'economy_exchange_recalibration_weekly' limit 1;
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
  perform cron.schedule(
    'economy_exchange_recalibration_weekly',
    '0 6 * * 1',
    $$select public.invoke_segna_app_cron('/api/cron/economy-exchange-recalibration');$$
  );
end
$do$;
