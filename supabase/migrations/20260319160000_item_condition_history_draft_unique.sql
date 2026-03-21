-- Une seule ligne draft par item : la modifier remplace l'existante (upsert sémantique).
-- On supprime les doublons existants puis on ajoute la contrainte.
delete from public.item_condition_history a
using public.item_condition_history b
where a.item_id = b.item_id
  and a.status = 'draft'
  and b.status = 'draft'
  and a.recorded_at < b.recorded_at;

create unique index if not exists idx_item_condition_history_item_draft_unique
  on public.item_condition_history (item_id)
  where status = 'draft';

comment on index public.idx_item_condition_history_item_draft_unique is
  'Une seule condition draft par item ; la modifier = remplacer la ligne existante';

-- DELETE/UPDATE sur draft : owner peut supprimer ou modifier sa ligne draft (pour replace)
drop policy if exists "item_condition_history_delete_draft_via_owner" on public.item_condition_history;
create policy "item_condition_history_delete_draft_via_owner"
  on public.item_condition_history for delete
  to authenticated
  using (
    status = 'draft'
    and exists (
      select 1 from public.items i
      where i.id = item_condition_history.item_id
        and i.owner_user_id = auth.uid()
        and i.deleted_at is null
    )
  );

drop policy if exists "item_condition_history_update_draft_via_owner" on public.item_condition_history;
create policy "item_condition_history_update_draft_via_owner"
  on public.item_condition_history for update
  to authenticated
  using (
    status = 'draft'
    and exists (
      select 1 from public.items i
      where i.id = item_condition_history.item_id
        and i.owner_user_id = auth.uid()
        and i.deleted_at is null
    )
  )
  with check (
    status = 'draft'
    and exists (
      select 1 from public.items i
      where i.id = item_condition_history.item_id
        and i.owner_user_id = auth.uid()
        and i.deleted_at is null
    )
  );

grant delete, update on public.item_condition_history to authenticated;
