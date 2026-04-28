-- Historique des transitions d'expédition : RPC append-only avec contexte (qui / quand / où).
-- metadata : JSON (source, route, correlation_id, etc.) ; reason : libellé humain ou défaut statut→statut.

alter table public.shipment_status_history
  add column if not exists metadata jsonb not null default '{}'::jsonb;

comment on column public.shipment_status_history.metadata is
  'Contexte append-only : source (member_app|backoffice|system|…), route, correlation_id, shipment_context, etc.';

create index if not exists shipment_status_history_shipment_created_idx
  on public.shipment_status_history (shipment_id, created_at desc);

create or replace function public.append_shipment_status_history(
  p_shipment_id uuid,
  p_to_status public.shipment_status,
  p_from_status public.shipment_status default null,
  p_actor_user_id uuid default null,
  p_reason text default null,
  p_source text default 'system',
  p_context jsonb default '{}'::jsonb,
  p_occurred_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path to public
as $fn$
declare
  v_id uuid;
  v_ts timestamptz := coalesce(p_occurred_at, now());
  v_src text := nullif(trim(coalesce(p_source, '')), '');
  v_meta jsonb;
  v_reason text;
  v_ctx public.shipment_context;
  v_cart_id uuid;
begin
  if p_shipment_id is null then
    raise exception 'p_shipment_id is required';
  end if;
  if p_to_status is null then
    raise exception 'p_to_status is required';
  end if;

  select s.context, s.cart_id
  into v_ctx, v_cart_id
  from public.shipments s
  where s.id = p_shipment_id
    and s.deleted_at is null;

  if not found then
    raise exception 'Shipment not found or deleted: %', p_shipment_id;
  end if;

  if p_actor_user_id is not null
     and not exists (select 1 from public.users u where u.id = p_actor_user_id) then
    raise exception 'actor_user_id not found: %', p_actor_user_id;
  end if;

  if v_src is null then
    v_src := 'system';
  end if;

  v_meta :=
    jsonb_strip_nulls(
      jsonb_build_object(
        'source', to_jsonb(v_src),
        'occurred_at', to_jsonb(v_ts),
        'shipment_id', to_jsonb(p_shipment_id),
        'shipment_context', to_jsonb(v_ctx::text),
        'cart_id', to_jsonb(v_cart_id),
        'from_status', case when p_from_status is null then null else to_jsonb(p_from_status::text) end,
        'to_status', to_jsonb(p_to_status::text)
      )
    )
    || coalesce(p_context, '{}'::jsonb);

  v_reason := nullif(trim(coalesce(p_reason, '')), '');
  if v_reason is null then
    v_reason := coalesce(p_from_status::text, '(initial)') || ' → ' || p_to_status::text;
  end if;

  insert into public.shipment_status_history (
    shipment_id,
    from_status,
    to_status,
    reason,
    actor_user_id,
    created_at,
    metadata
  )
  values (
    p_shipment_id,
    p_from_status,
    p_to_status,
    v_reason,
    p_actor_user_id,
    v_ts,
    v_meta
  )
  returning id into v_id;

  return v_id;
end;
$fn$;

comment on function public.append_shipment_status_history(
  uuid,
  public.shipment_status,
  public.shipment_status,
  uuid,
  text,
  text,
  jsonb,
  timestamptz
) is
  'Insère une ligne shipment_status_history (audit). Qui : actor_user_id + metadata.source ; quand : created_at / metadata.occurred_at ; où / contexte : metadata (contexte expédition, cart_id, champs libres). Réservé service_role.';

revoke all on function public.append_shipment_status_history(
  uuid,
  public.shipment_status,
  public.shipment_status,
  uuid,
  text,
  text,
  jsonb,
  timestamptz
) from public;

grant execute on function public.append_shipment_status_history(
  uuid,
  public.shipment_status,
  public.shipment_status,
  uuid,
  text,
  text,
  jsonb,
  timestamptz
) to service_role;
