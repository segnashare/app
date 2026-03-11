-- Make auth user deletion deterministic:
-- - nullable actor/reference columns -> ON DELETE SET NULL
-- - required ownership columns -> ON DELETE CASCADE

alter table public.activity_events drop constraint if exists activity_events_actor_user_id_fkey;
alter table public.activity_events
  add constraint activity_events_actor_user_id_fkey
  foreign key (actor_user_id) references public.users(id) on delete set null;

alter table public.cart_status_history drop constraint if exists cart_status_history_actor_user_id_fkey;
alter table public.cart_status_history
  add constraint cart_status_history_actor_user_id_fkey
  foreign key (actor_user_id) references public.users(id) on delete set null;

alter table public.item_price_history drop constraint if exists item_price_history_actor_user_id_fkey;
alter table public.item_price_history
  add constraint item_price_history_actor_user_id_fkey
  foreign key (actor_user_id) references public.users(id) on delete set null;

alter table public.item_status_history drop constraint if exists item_status_history_actor_user_id_fkey;
alter table public.item_status_history
  add constraint item_status_history_actor_user_id_fkey
  foreign key (actor_user_id) references public.users(id) on delete set null;

alter table public.moderation_actions drop constraint if exists moderation_actions_actor_user_id_fkey;
alter table public.moderation_actions
  add constraint moderation_actions_actor_user_id_fkey
  foreign key (actor_user_id) references public.users(id) on delete set null;

alter table public.moderation_cases drop constraint if exists moderation_cases_assigned_to_user_id_fkey;
alter table public.moderation_cases
  add constraint moderation_cases_assigned_to_user_id_fkey
  foreign key (assigned_to_user_id) references public.users(id) on delete set null;

alter table public.moderation_cases drop constraint if exists moderation_cases_opened_by_user_id_fkey;
alter table public.moderation_cases
  add constraint moderation_cases_opened_by_user_id_fkey
  foreign key (opened_by_user_id) references public.users(id) on delete set null;

alter table public.moderation_evidence drop constraint if exists moderation_evidence_uploaded_by_user_id_fkey;
alter table public.moderation_evidence
  add constraint moderation_evidence_uploaded_by_user_id_fkey
  foreign key (uploaded_by_user_id) references public.users(id) on delete set null;

alter table public.moderation_notes drop constraint if exists moderation_notes_author_user_id_fkey;
alter table public.moderation_notes
  add constraint moderation_notes_author_user_id_fkey
  foreign key (author_user_id) references public.users(id) on delete set null;

alter table public.shipment_items drop constraint if exists shipment_items_checked_by_user_id_fkey;
alter table public.shipment_items
  add constraint shipment_items_checked_by_user_id_fkey
  foreign key (checked_by_user_id) references public.users(id) on delete set null;

alter table public.shipment_proofs drop constraint if exists shipment_proofs_created_by_user_id_fkey;
alter table public.shipment_proofs
  add constraint shipment_proofs_created_by_user_id_fkey
  foreign key (created_by_user_id) references public.users(id) on delete set null;

alter table public.shipment_status_history drop constraint if exists shipment_status_history_actor_user_id_fkey;
alter table public.shipment_status_history
  add constraint shipment_status_history_actor_user_id_fkey
  foreign key (actor_user_id) references public.users(id) on delete set null;

alter table public.user_blocks drop constraint if exists user_blocks_blocked_by_user_id_fkey;
alter table public.user_blocks
  add constraint user_blocks_blocked_by_user_id_fkey
  foreign key (blocked_by_user_id) references public.users(id) on delete set null;

alter table public.user_status_history drop constraint if exists user_status_history_actor_user_id_fkey;
alter table public.user_status_history
  add constraint user_status_history_actor_user_id_fkey
  foreign key (actor_user_id) references public.users(id) on delete set null;

alter table public.cart_deposits drop constraint if exists cart_deposits_user_id_fkey;
alter table public.cart_deposits
  add constraint cart_deposits_user_id_fkey
  foreign key (user_id) references public.users(id) on delete cascade;

alter table public.cart_disputes drop constraint if exists cart_disputes_opened_by_user_id_fkey;
alter table public.cart_disputes
  add constraint cart_disputes_opened_by_user_id_fkey
  foreign key (opened_by_user_id) references public.users(id) on delete cascade;

alter table public.cart_items drop constraint if exists cart_items_owner_user_id_fkey;
alter table public.cart_items
  add constraint cart_items_owner_user_id_fkey
  foreign key (owner_user_id) references public.users(id) on delete cascade;

alter table public.cart_payments drop constraint if exists cart_payments_payer_user_id_fkey;
alter table public.cart_payments
  add constraint cart_payments_payer_user_id_fkey
  foreign key (payer_user_id) references public.users(id) on delete cascade;

alter table public.cart_refunds drop constraint if exists cart_refunds_user_id_fkey;
alter table public.cart_refunds
  add constraint cart_refunds_user_id_fkey
  foreign key (user_id) references public.users(id) on delete cascade;

alter table public.carts drop constraint if exists carts_user_id_fkey;
alter table public.carts
  add constraint carts_user_id_fkey
  foreign key (user_id) references public.users(id) on delete cascade;

alter table public.item_inventory_locks drop constraint if exists item_inventory_locks_locked_by_user_id_fkey;
alter table public.item_inventory_locks
  add constraint item_inventory_locks_locked_by_user_id_fkey
  foreign key (locked_by_user_id) references public.users(id) on delete cascade;

alter table public.item_reports drop constraint if exists item_reports_reporter_user_id_fkey;
alter table public.item_reports
  add constraint item_reports_reporter_user_id_fkey
  foreign key (reporter_user_id) references public.users(id) on delete cascade;

alter table public.items drop constraint if exists items_owner_user_id_fkey;
alter table public.items
  add constraint items_owner_user_id_fkey
  foreign key (owner_user_id) references public.users(id) on delete cascade;
