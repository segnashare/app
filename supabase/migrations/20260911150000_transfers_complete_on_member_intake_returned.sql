-- Clôture enveloppe logistique quand le colis member_intake est reçu chez Segna (returned).
-- Conserve shipments.transfer_id (lien historique) ; libère les pièces pour un futur envoi.

alter table public.transfers
  add column if not exists completed_at timestamptz;

comment on column public.transfers.completed_at is
  'Enveloppe terminée (ex. member_intake → returned). Null = enveloppe active pour regroupement / shipping.';

create index if not exists transfers_user_active_idx
  on public.transfers (user_id)
  where deleted_at is null and completed_at is null;

create or replace function public.complete_member_intake_transfer_for_shipment(p_shipment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transfer_id uuid;
begin
  if p_shipment_id is null then
    return;
  end if;

  select s.transfer_id into v_transfer_id
  from public.shipments s
  where s.id = p_shipment_id
    and s.deleted_at is null
    and s.context = 'member_intake'::public.shipment_context;

  if v_transfer_id is null then
    return;
  end if;

  update public.transfers
  set
    completed_at = coalesce(completed_at, timezone('utc', now())),
    updated_at = timezone('utc', now())
  where id = v_transfer_id
    and deleted_at is null;

  update public.transfer_items
  set deleted_at = coalesce(deleted_at, timezone('utc', now()))
  where transfer_id = v_transfer_id
    and deleted_at is null;
end;
$$;

comment on function public.complete_member_intake_transfer_for_shipment(uuid) is
  'member_intake returned : clôture transfer (completed_at) + détache pièces ; garde shipments.transfer_id.';

create or replace function public.transition_shipment_status(
  p_shipment_id uuid,
  p_if_current_status public.shipment_status,
  p_to_status public.shipment_status,
  p_actor_user_id uuid default null,
  p_reason text default null,
  p_source text default 'system',
  p_context jsonb default '{}'::jsonb,
  p_occurred_at timestamptz default null,
  p_set_ready_at boolean default true,
  p_tracking_number text default null
)
returns jsonb
language plpgsql
security definer
set search_path to public
as $fn$
declare
  v_ts timestamptz := coalesce(p_occurred_at, timezone('utc', now()));
  v_n int;
  v_hid uuid;
  v_context text;
begin
  if p_shipment_id is null then
    return jsonb_build_object('ok', false, 'error', 'p_shipment_id is required');
  end if;
  if p_to_status is null then
    return jsonb_build_object('ok', false, 'error', 'p_to_status is required');
  end if;
  if p_if_current_status is not distinct from p_to_status then
    return jsonb_build_object('ok', false, 'error', 'NO_STATUS_CHANGE');
  end if;

  update public.shipments s
  set
    status = p_to_status,
    updated_at = v_ts,
    tracking_number = case
      when p_tracking_number is not null and length(trim(p_tracking_number)) > 0 then trim(p_tracking_number)
      else s.tracking_number
    end,
    ready_at = case
      when coalesce(p_set_ready_at, true)
        and p_to_status = 'ready'::public.shipment_status
        and s.ready_at is null then v_ts
      else s.ready_at
    end,
    delivered_at = case
      when p_to_status = 'delivered'::public.shipment_status and s.delivered_at is null then v_ts
      else s.delivered_at
    end
  where s.id = p_shipment_id
    and s.deleted_at is null
    and s.status = p_if_current_status;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    return jsonb_build_object('ok', false, 'error', 'STATUS_MISMATCH');
  end if;

  select s.context::text into v_context
  from public.shipments s
  where s.id = p_shipment_id;

  if p_to_status = 'dropped_out'::public.shipment_status and v_context = 'member_intake' then
    perform public.promote_member_intake_items_to_shipping(p_shipment_id);
  end if;

  if p_to_status in (
    'delivered'::public.shipment_status,
    'returned'::public.shipment_status,
    'en_verification'::public.shipment_status
  ) then
    if v_context in ('member_intake', 'cart_return') then
      perform public.promote_intake_items_to_in_verification_on_shipment_delivered(p_shipment_id);
    end if;
  end if;

  if p_to_status = 'returned'::public.shipment_status and v_context = 'member_intake' then
    perform public.complete_member_intake_transfer_for_shipment(p_shipment_id);
  end if;

  select public.append_shipment_status_history(
    p_shipment_id := p_shipment_id,
    p_to_status := p_to_status,
    p_from_status := p_if_current_status,
    p_actor_user_id := p_actor_user_id,
    p_reason := p_reason,
    p_source := p_source,
    p_context := p_context,
    p_occurred_at := v_ts
  )
  into v_hid;

  return jsonb_build_object('ok', true, 'history_id', v_hid);
end;
$fn$;

comment on function public.transition_shipment_status(
  uuid,
  public.shipment_status,
  public.shipment_status,
  uuid,
  text,
  text,
  jsonb,
  timestamptz,
  boolean,
  text
) is
  'Statut colis ; member_intake returned → clôture transfer ; dropped_out → shipping ; returned → in_verification.';

-- RPC : inclut pièces d'une enveloppe clôturée (transfer_items archivés).
create or replace function public.member_intake_item_ids_from_shipment(p_shipment_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select array_agg(ti.item_id order by ti.sort_order, ti.item_id)
      from public.transfer_items ti
      join public.shipments s on s.transfer_id = ti.transfer_id
      where s.id = p_shipment_id
        and ti.deleted_at is null
        and s.deleted_at is null
    ),
    (
      select array_agg(ti.item_id order by ti.sort_order, ti.item_id)
      from public.transfer_items ti
      join public.shipments s on s.transfer_id = ti.transfer_id
      where s.id = p_shipment_id
        and ti.deleted_at is not null
        and s.deleted_at is null
    ),
    '{}'::uuid[]
  );
$$;

-- Rattrapage : colis déjà returned avec enveloppe encore active.
do $backfill$
declare
  v_ship record;
begin
  for v_ship in
    select s.id
    from public.shipments s
    join public.transfers t on t.id = s.transfer_id
    where s.deleted_at is null
      and s.context = 'member_intake'::public.shipment_context
      and lower(s.status::text) in ('returned', 'en_verification', 'closed')
      and t.deleted_at is null
      and t.completed_at is null
  loop
    perform public.complete_member_intake_transfer_for_shipment(v_ship.id);
  end loop;
end;
$backfill$;
