-- Index ciblés sur les chemins lents BO / webhooks / pages membre lourdes.

do $$
begin
  if to_regclass('public.shipments') is not null then
    execute '
      create index if not exists shipments_context_tracking_created_idx
      on public.shipments (context, tracking_number, created_at desc)
      where deleted_at is null
    ';
  end if;

  if to_regclass('public.wallet_transactions') is not null then
    execute '
      create index if not exists wallet_transactions_cart_order_debit_lookup_idx
      on public.wallet_transactions (user_id, ((metadata->>''cart_id'')), created_at)
      where kind = ''debit''
        and direction = ''debit''
        and metadata->>''source'' = ''cart_order_stripe''
    ';
  end if;

  if to_regclass('public.user_identity_verifications') is not null then
    execute '
      create index if not exists user_identity_verifications_user_updated_idx
      on public.user_identity_verifications (user_id, updated_at desc)
    ';
  end if;

  if to_regclass('public.cms_app_section_on_page') is not null then
    execute '
      create index if not exists idx_cms_app_section_on_page_active_sort_id
      on public.cms_app_section_on_page (page_key, page_sort_order, id)
      where deleted_at is null
    ';
  end if;
end
$$;
