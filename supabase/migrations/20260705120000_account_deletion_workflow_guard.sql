-- Workflow de suppression de compte (membre) avec garde-fous métier.
-- Règle : pas de suppression tant qu'il reste des commandes/retours non clôturés.

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'account_deletion_request_status'
  ) then
    create type public.account_deletion_request_status as enum (
      'pending',
      'blocked',
      'approved',
      'rejected',
      'completed',
      'canceled'
    );
  end if;
end
$$;

create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  status public.account_deletion_request_status not null default 'pending',
  reason text null,
  blocker_snapshot jsonb not null default '{}'::jsonb,
  requested_at timestamptz not null default timezone('utc', now()),
  processed_at timestamptz null,
  processed_by uuid null references public.users(id) on delete set null,
  notes text null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz null
);

comment on table public.account_deletion_requests is
  'Demandes de suppression de compte. Le workflow côté app bloque la demande si des commandes/retours sont encore ouverts.';

create index if not exists account_deletion_requests_user_idx
  on public.account_deletion_requests (user_id, requested_at desc)
  where deleted_at is null;

create unique index if not exists account_deletion_requests_user_active_unique_idx
  on public.account_deletion_requests (user_id)
  where deleted_at is null
    and status in ('pending'::public.account_deletion_request_status, 'blocked'::public.account_deletion_request_status);

drop trigger if exists account_deletion_requests_set_updated_at on public.account_deletion_requests;
create trigger account_deletion_requests_set_updated_at
before update on public.account_deletion_requests
for each row
execute function public.set_updated_at();

alter table public.account_deletion_requests enable row level security;

drop policy if exists "account_deletion_requests_select_own" on public.account_deletion_requests;
create policy "account_deletion_requests_select_own"
on public.account_deletion_requests
for select
to authenticated
using (user_id = auth.uid() and deleted_at is null);

drop policy if exists "account_deletion_requests_insert_own" on public.account_deletion_requests;
create policy "account_deletion_requests_insert_own"
on public.account_deletion_requests
for insert
to authenticated
with check (user_id = auth.uid());

create or replace function public.get_my_account_deletion_guard()
returns jsonb
language plpgsql
security definer
set search_path to public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_open_carts int := 0;
  v_open_outbound_shipments int := 0;
  v_open_return_shipments int := 0;
  v_open_cart_items int := 0;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select count(*)
    into v_open_carts
  from public.carts c
  where c.user_id = v_uid
    and c.deleted_at is null
    and c.status in (
      'active'::public.cart_status,
      'checkout_pending'::public.cart_status,
      'confirmed'::public.cart_status,
      'disputed'::public.cart_status
    );

  select count(*)
    into v_open_outbound_shipments
  from public.shipments s
  join public.carts c on c.id = s.cart_id
  where c.user_id = v_uid
    and c.deleted_at is null
    and s.deleted_at is null
    and s.context = 'cart_outbound'::public.shipment_context
    and s.status is distinct from 'closed'::public.shipment_status;

  select count(*)
    into v_open_return_shipments
  from public.shipments s
  join public.carts c on c.id = s.cart_id
  where c.user_id = v_uid
    and c.deleted_at is null
    and s.deleted_at is null
    and s.context = 'cart_return'::public.shipment_context
    and s.status is distinct from 'closed'::public.shipment_status;

  select count(*)
    into v_open_cart_items
  from public.cart_items ci
  join public.carts c on c.id = ci.cart_id
  where c.user_id = v_uid
    and c.deleted_at is null
    and ci.deleted_at is null
    and ci.status in (
      'reserved'::public.cart_item_status,
      'verification_pending'::public.cart_item_status
    );

  return jsonb_build_object(
    'blocked',
    (v_open_carts + v_open_outbound_shipments + v_open_return_shipments + v_open_cart_items) > 0,
    'blockers',
    jsonb_build_object(
      'open_carts', v_open_carts,
      'open_outbound_shipments', v_open_outbound_shipments,
      'open_return_shipments', v_open_return_shipments,
      'open_cart_items', v_open_cart_items
    )
  );
end;
$fn$;

comment on function public.get_my_account_deletion_guard() is
  'Retourne les blocages métier empêchant la suppression de compte (commandes/retours non clôturés).';

revoke all on function public.get_my_account_deletion_guard() from public;
grant execute on function public.get_my_account_deletion_guard() to authenticated;

create or replace function public.request_my_account_deletion(p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path to public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_guard jsonb;
  v_blocked boolean := false;
  v_existing_id uuid;
  v_request_id uuid;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  v_guard := public.get_my_account_deletion_guard();
  v_blocked := coalesce((v_guard ->> 'blocked')::boolean, false);

  select r.id
    into v_existing_id
  from public.account_deletion_requests r
  where r.user_id = v_uid
    and r.deleted_at is null
    and r.status in ('pending'::public.account_deletion_request_status, 'blocked'::public.account_deletion_request_status)
  order by r.requested_at desc
  limit 1
  for update;

  if v_existing_id is not null then
    update public.account_deletion_requests r
    set
      status = case when v_blocked then 'blocked'::public.account_deletion_request_status else 'pending'::public.account_deletion_request_status end,
      reason = coalesce(nullif(trim(p_reason), ''), r.reason),
      blocker_snapshot = coalesce(v_guard -> 'blockers', '{}'::jsonb),
      requested_at = timezone('utc', now()),
      processed_at = null,
      processed_by = null,
      notes = null,
      updated_at = timezone('utc', now())
    where r.id = v_existing_id
    returning r.id into v_request_id;
  else
    insert into public.account_deletion_requests (
      user_id,
      status,
      reason,
      blocker_snapshot
    )
    values (
      v_uid,
      case when v_blocked then 'blocked'::public.account_deletion_request_status else 'pending'::public.account_deletion_request_status end,
      nullif(trim(p_reason), ''),
      coalesce(v_guard -> 'blockers', '{}'::jsonb)
    )
    returning id into v_request_id;
  end if;

  return jsonb_build_object(
    'ok', not v_blocked,
    'blocked', v_blocked,
    'request_id', v_request_id,
    'guard', v_guard
  );
end;
$fn$;

comment on function public.request_my_account_deletion(text) is
  'Crée/actualise une demande de suppression. Renvoie blocked=true tant que commandes/retours ne sont pas clôturés.';

revoke all on function public.request_my_account_deletion(text) from public;
grant execute on function public.request_my_account_deletion(text) to authenticated;
