-- Remove current_condition_id from items: condition is already in item_condition_history via item_id
drop trigger if exists trg_item_condition_history_sync_current on public.item_condition_history;
drop function if exists public.sync_item_current_condition_id();
drop index if exists public.idx_items_current_condition_id;
alter table public.items drop column if exists current_condition_id;
