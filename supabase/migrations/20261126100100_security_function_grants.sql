-- Sécurité (audit 2026-09-26, C2 / C3 / C4 / M1) : moindre privilège sur les fonctions.
--
-- Supabase accorde par défaut EXECUTE à anon / authenticated sur toute fonction créée dans `public`.
-- Résultat : des RPC `security definer` sans contrôle (wallet_credit_purchase, billing_upsert_monthly_entitlement,
-- backoffice_fetch_users_page…) étaient appelables par n'importe quel membre.
--
-- Règle appliquée ici :
--   * toute fonction `security definer` non-trigger du schéma public est révoquée pour public/anon/authenticated,
--     sauf la liste blanche ci-dessous (RPC appelées par l'app, le mobile ou utilisées dans les policies) ;
--   * les fonctions trigger et les fonctions `security invoker` gardent leurs droits (pas d'escalade possible) ;
--   * les privilèges par défaut sont modifiés : toute NOUVELLE fonction devra recevoir un `grant execute … to authenticated`
--     explicite dans sa migration pour être appelable côté client.

-- 1) Révocation ciblée immédiate des fonctions critiques (idempotent, gère les surcharges).
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'wallet_credit_purchase',
        'billing_upsert_monthly_entitlement',
        'backoffice_fetch_users_page',
        'log_activity_event_staff',
        'purge_expired_user_sessions',
        'wallet_apply_retired_lend_debit',
        'refresh_backoffice_wallet_economy_kpis'
      )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

-- 2) Liste blanche des RPC membre + helpers de policies, puis révocation générale des security definer.
do $$
declare
  r record;
  v_allow text[] := array[
    'accept_user_consent',
    'billing_borrow_checkout_options_active',
    'billing_has_role',
    'billing_is_admin',
    'bootstrap_user_after_signup',
    'complete_onboarding',
    'email_available_for_user_change',
    'get_cart_items_competition_state',
    'get_cart_outbound_shipment_summary',
    'get_cart_outfit_suggestions',
    'get_cart_upsell_suggestions',
    'get_catalog_tag_page_v1',
    'get_cms_auth_landing_frames',
    'get_cms_boutique_section_order',
    'get_cms_catalog_section',
    'get_cms_echange_section_order',
    'get_cms_home_section_order',
    'get_cms_panier_section_order',
    'get_cms_section_frames',
    'get_cms_section_published_config',
    'get_community_feed_v1',
    'get_community_inspirations_by_tag_page_slug',
    'get_current_membership_state',
    'get_effective_plan_code_for_cms',
    'get_feedback_rating_average',
    'get_feedback_rating_summary',
    'get_home_feed_v1',
    'get_home_style_looks_v1',
    'get_inspiration_detail_v1',
    'get_item_exchange_count',
    'get_item_more_catalog_pieces_v1',
    'get_item_outfit_look',
    'get_item_style_looks_v1',
    'get_look_related_style_looks_v1',
    'get_me_context',
    'get_member_cart_order_checkout_context',
    'get_member_cart_order_stripe_invoice',
    'get_member_inspirations_v1',
    'get_member_kyc_verified',
    'get_my_account_deletion_guard',
    'get_profile_preference_visibility',
    'get_related_inspirations_v1',
    'get_shop_boutique_filter_facets',
    'get_shop_catalog_excluding_user_favorites',
    'get_shop_catalog_items',
    'get_shop_catalog_items_by_ids',
    'get_shop_catalog_items_by_tag_page_slug',
    'get_shop_featured_lenders',
    'get_shop_most_liked_fraction',
    'get_shop_most_liked_items',
    'get_shop_newest_fraction',
    'get_shop_user_favorite_items',
    'get_user_exchange_count',
    'has_role',
    'is_admin',
    'is_profile_eligible_for_home_feed',
    'is_staff',
    'item_borrowable_for_outfit_suggestion',
    'item_size_matches_member_profile',
    'list_catalog_tags_v1',
    'list_fashion_tags_v1',
    'list_item_feedbacks_for_display',
    'list_item_worn_photo_paths',
    'list_my_user_blocks_v1',
    'log_activity_event',
    'mark_item_draft_deleted',
    'member_cancel_cart_order_pending_preparation',
    'phone_available_for_user_change',
    'phone_is_multi_account_exception',
    'promote_pre_subscribe_intakes_to_shipping',
    'publish_community_inspiration',
    'qualify_pending_referral',
    'record_member_feed_impression',
    'record_member_inspiration_impression',
    'record_member_item_interaction',
    'record_member_profile_interaction',
    'release_wallet_hold',
    'report_community_inspiration',
    'request_my_account_deletion',
    'reserve_cart_atomic',
    'revoke_other_user_sessions',
    'revoke_user_session',
    'rls_cart_dispute_is_mine',
    'rls_cart_is_mine',
    'rls_item_is_mine',
    'rls_shipment_is_mine',
    'save_onboarding_progress',
    'set_admin_phantom_mode',
    'set_profile_preference_visibility',
    'set_user_birth_date',
    'set_user_location',
    'set_user_phone_verified',
    'set_user_profile_brands',
    'set_user_profile_sizes',
    'toggle_inspiration_like',
    'toggle_member_follow',
    'update_user_account_settings',
    'update_user_profile_public',
    'upsert_onboarding_progress',
    'upsert_user_session',
    'user_can_lend_items',
    'user_can_reserve_cart_inventory',
    'user_is_staff_admin',
    'xp_award_action',
    'xp_award_badge',
    'xp_get_badges_progress',
    'xp_get_level_for_xp',
    'xp_has_role',
    'xp_is_admin',
    'xp_is_moderator_or_admin',
    'xp_record_badge_achievement',
    'xp_touch_daily_visit'
  ];
  v_anon text[] := array['get_cms_auth_landing_frames', 'get_cms_section_published_config'];
begin
  for r in
    select p.oid::regprocedure as sig, p.proname, p.prosecdef, p.prorettype = 'trigger'::regtype as is_trigger
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
  loop
    if r.is_trigger then
      continue;
    end if;

    if r.proname = any (v_allow) then
      execute format('revoke execute on function %s from public, anon', r.sig);
      execute format('grant execute on function %s to authenticated, service_role', r.sig);
      if r.proname = any (v_anon) then
        execute format('grant execute on function %s to anon', r.sig);
      end if;
    elsif r.prosecdef then
      execute format('revoke all on function %s from public, anon, authenticated', r.sig);
      execute format('grant execute on function %s to service_role', r.sig);
    end if;
  end loop;
end $$;

-- 3) Plus d'EXECUTE automatique pour anon / authenticated sur les futures fonctions de `public`.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'postgres') then
    execute 'alter default privileges for role postgres in schema public revoke execute on functions from public';
    execute 'alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated';
  end if;
exception
  when others then
    raise notice 'default privileges (postgres role) not adjusted: %', sqlerrm;
end $$;

-- Recharge le cache PostgREST pour que les nouveaux droits s'appliquent sans redémarrage.
notify pgrst, 'reload schema';
