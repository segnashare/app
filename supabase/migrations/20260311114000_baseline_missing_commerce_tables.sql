-- Tables / enums référencés avant leurs migrations historiques (trou dans la chaîne Git).
-- Idempotent : safe sur une base déjà peuplée par d’anciennes migrations manuelles.
-- Schéma aligné sur l’instance Segna de référence (public.*, mai 2026).

create extension if not exists pgcrypto;

-- Colonnes activity_events : voir 20260311115100_activity_events_audit_columns.sql
-- (évite de modifier une migration déjà appliquée sur une remote).

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'cart_status'
  ) then
    create type public.cart_status as enum (
      'active', 'checkout_pending', 'confirmed', 'archived', 'canceled'
    );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'item_status'
  ) then
    create type public.item_status as enum (
      'draft',
      'draft_deleted',
      'listed',
      'available',
      'in_cart',
      'reserved',
      'retired',
      'cleaning',
      'archived',
      'refused'
    );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'cart_item_status'
  ) then
    create type public.cart_item_status as enum (
      'in_cart',
      'reserved',
      'archived',
      'reservation_pending',
      'verification_pending',
      'verified',
      'rejected',
      'needs_cleaning'
    );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'moderation_case_status'
  ) then
    create type public.moderation_case_status as enum (
      'open', 'in_review', 'resolved', 'closed'
    );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'shipment_return_status'
  ) then
    create type public.shipment_return_status as enum (
      'pending_verification',
      'en_verification',
      'validated',
      'dommage',
      'nettoyage',
      'nettoyage_leger',
      'rejected'
    );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'shipment_status'
  ) then
    create type public.shipment_status as enum (
      'pending',
      'ready',
      'dropped_in',
      'in_transit',
      'delivered',
      'returned',
      'en_verification',
      'return_validated',
      'failed',
      'closed',
      'in_transit_in',
      'in_transit_out',
      'dropped_out'
    );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'shipment_context'
  ) then
    create type public.shipment_context as enum (
      'cart_outbound',
      'cart_return',
      'member_intake',
      'member_outtake',
      'other'
    );
  end if;
end $$;

-- item_intake_listing_stage / item_intake_fulfillment_stage : laisser 20260325100000_item_intake_outtake.sql
-- créer les types (historique shipped_in / verification_pending → trim ultérieur).

-- ---------------------------------------------------------------------------
-- Catalogues & cœur panier / expédition
-- ---------------------------------------------------------------------------

create table if not exists public.sizes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.item_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  parent_category_id uuid references public.item_categories (id) on delete set null,
  size_scope text default 'none'::text,
  vinted_id bigint
);

create unique index if not exists item_categories_slug_key
  on public.item_categories (slug);

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.users (id) on delete cascade,
  item_category_id uuid references public.item_categories (id) on delete set null,
  item_size_id uuid references public.sizes (id) on delete set null,
  title text not null,
  description text,
  price_points integer,
  status public.item_status not null default 'available'::public.item_status,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint items_deleted_at_check check (deleted_at is null or deleted_at <= now())
);

create table if not exists public.carts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  status public.cart_status not null default 'active'::public.cart_status,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint carts_deleted_at_check check (deleted_at is null or deleted_at <= now())
);

create table if not exists public.cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  owner_user_id uuid not null references public.users (id) on delete cascade,
  status public.cart_item_status not null default 'in_cart'::public.cart_item_status,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  return_verification jsonb,
  constraint cart_items_deleted_at_check check (deleted_at is null or deleted_at <= now())
);

create table if not exists public.cart_status_history (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts (id) on delete cascade,
  from_status public.cart_status,
  to_status public.cart_status not null,
  reason text,
  actor_user_id uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.item_price_history (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items (id) on delete cascade,
  old_price_points integer,
  new_price_points integer not null,
  reason text,
  actor_user_id uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.item_status_history (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items (id) on delete cascade,
  from_status public.item_status,
  to_status public.item_status not null,
  reason text,
  actor_user_id uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.moderation_cases (
  id uuid primary key default gen_random_uuid(),
  status public.moderation_case_status not null default 'open'::public.moderation_case_status,
  severity text not null default 'medium'::text,
  opened_by_user_id uuid references public.users (id) on delete set null,
  assigned_to_user_id uuid references public.users (id) on delete set null,
  resolution text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  moderation_case_id uuid not null references public.moderation_cases (id) on delete cascade,
  action_type text not null,
  action_payload jsonb not null default '{}'::jsonb,
  actor_user_id uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.moderation_evidence (
  id uuid primary key default gen_random_uuid(),
  moderation_case_id uuid not null references public.moderation_cases (id) on delete cascade,
  evidence_type text not null,
  file_url text not null,
  metadata jsonb not null default '{}'::jsonb,
  uploaded_by_user_id uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.moderation_notes (
  id uuid primary key default gen_random_uuid(),
  moderation_case_id uuid not null references public.moderation_cases (id) on delete cascade,
  note text not null,
  author_user_id uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  kind text not null,
  direction text not null,
  amount_points bigint not null,
  status text not null default 'posted'::text,
  idempotency_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  credit_bucket text
);

create unique index if not exists wallet_transactions_idempotency_key_key
  on public.wallet_transactions (idempotency_key);

create table if not exists public.cart_deposits (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  amount_points integer not null,
  deposit_status text not null default 'held'::text,
  wallet_transaction_id uuid references public.wallet_transactions (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.cart_disputes (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts (id) on delete cascade,
  opened_by_user_id uuid not null references public.users (id) on delete cascade,
  status text not null default 'open'::text,
  reason text,
  details text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.item_disputes (
  id uuid primary key default gen_random_uuid(),
  cart_dispute_id uuid not null references public.cart_disputes (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  reason text,
  details text,
  status text not null default 'open'::text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Aligné sur 20260526103000_cart_payments.sql (colonnes user_id, pas payer_user_id).
create table if not exists public.cart_payments (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts (id) on delete restrict,
  user_id uuid not null references public.users (id) on delete cascade,
  wallet_transaction_id uuid references public.wallet_transactions (id) on delete set null,
  total_points bigint not null check (total_points >= 0),
  exchange_points bigint not null default 0 check (exchange_points >= 0),
  consumption_points bigint not null default 0 check (consumption_points >= 0),
  check (exchange_points + consumption_points = total_points),
  stripe_wallet_topup_points bigint not null default 0 check (stripe_wallet_topup_points >= 0),
  stripe_wallet_topup_kind text,
  stripe_checkout_session_id text,
  payment_channel text not null check (payment_channel in ('stripe', 'wallet_only')),
  idempotency_key text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create table if not exists public.cart_refunds (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  amount_points integer not null,
  reason text,
  wallet_transaction_id uuid references public.wallet_transactions (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid references public.carts (id) on delete set null,
  status public.shipment_status not null default 'pending'::public.shipment_status,
  tracking_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  context public.shipment_context not null default 'cart_outbound'::public.shipment_context,
  ready_at timestamptz,
  member_tracking_url text,
  delivered_at timestamptz
);

create table if not exists public.shipment_items (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments (id) on delete cascade,
  cart_item_id uuid not null references public.cart_items (id) on delete cascade,
  return_status public.shipment_return_status not null default 'pending_verification'::public.shipment_return_status,
  checked_by_user_id uuid references public.users (id) on delete set null,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.shipment_proofs (
  id uuid primary key default gen_random_uuid(),
  shipment_item_id uuid not null references public.shipment_items (id) on delete cascade,
  proof_type text not null default 'photo'::text,
  file_url text not null,
  created_by_user_id uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.shipment_status_history (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments (id) on delete cascade,
  from_status public.shipment_status,
  to_status public.shipment_status not null,
  reason text,
  actor_user_id uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.user_blocks (
  id uuid primary key default gen_random_uuid(),
  blocked_user_id uuid references public.users (id) on delete set null,
  reason text,
  blocked_by_user_id uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  blocked_phone_e164 text,
  blocked_label text
);

create table if not exists public.item_reports (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items (id) on delete cascade,
  reporter_user_id uuid not null references public.users (id) on delete cascade,
  reason text not null,
  details text,
  status text not null default 'open'::text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
