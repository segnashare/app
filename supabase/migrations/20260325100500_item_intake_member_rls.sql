-- Permettre au propriétaire de synchroniser item_intake depuis l'app (evaluation, soumission, etc.)

drop policy if exists "item_intake_update_own" on public.item_intake;
create policy "item_intake_update_own"
on public.item_intake
for update
to authenticated
using (
  exists (
    select 1
    from public.items x
    where x.id = item_intake.item_id
      and x.owner_user_id = (select auth.uid())
      and x.deleted_at is null
  )
)
with check (
  exists (
    select 1
    from public.items x
    where x.id = item_intake.item_id
      and x.owner_user_id = (select auth.uid())
      and x.deleted_at is null
  )
);

drop policy if exists "item_intake_insert_own" on public.item_intake;
create policy "item_intake_insert_own"
on public.item_intake
for insert
to authenticated
with check (
  exists (
    select 1
    from public.items x
    where x.id = item_intake.item_id
      and x.owner_user_id = (select auth.uid())
      and x.deleted_at is null
  )
);
