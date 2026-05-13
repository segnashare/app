-- Indexes for the heavy backoffice read paths: items hub, logistics tabs,
-- users/wallets dashboards and feed preference analytics.

do $$
begin
  if to_regclass('public.items') is not null then
    execute 'create index if not exists items_status_updated_bo_idx on public.items (status, updated_at desc) where deleted_at is null';
    execute 'create index if not exists items_created_bo_idx on public.items (created_at desc) where deleted_at is null';
    execute 'create index if not exists items_brand_created_bo_idx on public.items (item_brand_id, created_at desc) where deleted_at is null';
    execute 'create index if not exists items_size_created_bo_idx on public.items (item_size_id, created_at desc) where deleted_at is null';
    execute 'create index if not exists items_category_created_bo_idx on public.items (item_category_id, created_at desc) where deleted_at is null';
  end if;

  if to_regclass('public.item_intake') is not null then
    execute 'create index if not exists item_intake_stage_item_bo_idx on public.item_intake (listing_stage, fulfillment_stage, item_id)';
    execute 'create index if not exists item_intake_item_bo_idx on public.item_intake (item_id)';
  end if;

  if to_regclass('public.item_outtake') is not null then
    execute 'create index if not exists item_outtake_stage_updated_bo_idx on public.item_outtake (stage, updated_at desc)';
    execute 'create index if not exists item_outtake_updated_bo_idx on public.item_outtake (updated_at desc)';
  end if;

  if to_regclass('public.item_condition_history') is not null then
    execute 'create index if not exists item_condition_history_item_recorded_bo_idx on public.item_condition_history (item_id, recorded_at desc)';
    execute 'create index if not exists item_condition_history_status_recorded_bo_idx on public.item_condition_history (status, recorded_at desc)';
  end if;

  if to_regclass('public.item_disputes') is not null then
    execute 'create index if not exists item_disputes_status_created_bo_idx on public.item_disputes (status, created_at desc) where deleted_at is null';
    execute 'create index if not exists item_disputes_item_created_bo_idx on public.item_disputes (item_id, created_at desc) where deleted_at is null';
  end if;

  if to_regclass('public.item_losses') is not null then
    execute 'create index if not exists item_losses_status_created_bo_idx on public.item_losses (status, created_at desc)';
    execute 'create index if not exists item_losses_item_created_bo_idx on public.item_losses (item_id, created_at desc)';
  end if;

  if to_regclass('public.carts') is not null then
    execute 'create index if not exists carts_status_updated_bo_idx on public.carts (status, updated_at desc) where deleted_at is null';
    execute 'create index if not exists carts_user_status_bo_idx on public.carts (user_id, status, updated_at desc) where deleted_at is null';
  end if;

  if to_regclass('public.cart_items') is not null then
    execute 'create index if not exists cart_items_cart_bo_idx on public.cart_items (cart_id) where deleted_at is null';
    execute 'create index if not exists cart_items_item_created_bo_idx on public.cart_items (item_id, created_at desc) where deleted_at is null';
    execute 'create index if not exists cart_items_status_updated_bo_idx on public.cart_items (status, updated_at desc) where deleted_at is null';
  end if;

  if to_regclass('public.shipments') is not null then
    execute 'create index if not exists shipments_context_status_updated_bo_idx on public.shipments (context, status, updated_at desc) where deleted_at is null';
    execute 'create index if not exists shipments_cart_context_created_bo_idx on public.shipments (cart_id, context, created_at desc) where deleted_at is null';
    execute 'create index if not exists shipments_context_updated_bo_idx on public.shipments (context, updated_at desc) where deleted_at is null';
  end if;

  if to_regclass('public.shipment_destinations') is not null then
    execute 'create index if not exists shipment_destinations_ship_type_bo_idx on public.shipment_destinations (shipment_id, destination_type, id desc)';
  end if;

  if to_regclass('public.shipment_labels') is not null then
    execute 'create index if not exists shipment_labels_ship_created_bo_idx on public.shipment_labels (shipment_id, created_at desc)';
  end if;

  if to_regclass('public.users') is not null then
    execute 'create index if not exists users_status_updated_bo_idx on public.users (status, updated_at desc) where deleted_at is null';
    execute 'create index if not exists users_created_bo_idx on public.users (created_at desc) where deleted_at is null';
  end if;

  if to_regclass('public.user_sessions') is not null then
    execute 'create index if not exists user_sessions_user_created_bo_idx on public.user_sessions (user_id, created_at desc)';
    execute 'create index if not exists user_sessions_created_bo_idx on public.user_sessions (created_at desc)';
  end if;

  if to_regclass('public.user_subscriptions') is not null then
    execute 'create index if not exists user_subscriptions_user_updated_bo_idx on public.user_subscriptions (user_id, updated_at desc)';
    execute 'create index if not exists user_subscriptions_plan_status_bo_idx on public.user_subscriptions (plan_code, status, updated_at desc)';
  end if;

  if to_regclass('public.user_wallets') is not null then
    execute 'create index if not exists user_wallets_balance_bo_idx on public.user_wallets (balance_points desc) where deleted_at is null';
  end if;

  if to_regclass('public.wallet_transactions') is not null then
    execute 'create index if not exists wallet_transactions_created_bo_idx on public.wallet_transactions (created_at desc)';
    execute 'create index if not exists wallet_transactions_user_created_bo_idx on public.wallet_transactions (user_id, created_at desc)';
    execute 'create index if not exists wallet_transactions_status_direction_bo_idx on public.wallet_transactions (status, direction, created_at desc)';
  end if;

  if to_regclass('public.member_feed_impressions') is not null then
    execute 'create index if not exists member_feed_impressions_surface_created_bo_idx on public.member_feed_impressions (feed_surface, created_at desc)';
  end if;

  if to_regclass('public.member_item_interactions') is not null then
    execute 'create index if not exists member_item_interactions_surface_created_bo_idx on public.member_item_interactions (source_surface, created_at desc)';
  end if;

  if to_regclass('public.member_profile_interactions') is not null then
    execute 'create index if not exists member_profile_interactions_surface_created_bo_idx on public.member_profile_interactions (source_surface, created_at desc)';
  end if;
end
$$;
