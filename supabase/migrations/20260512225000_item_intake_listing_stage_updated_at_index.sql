-- Accelere les lectures de pile d'alertes membre, filtrees par etape et triees par fraicheur.
create index if not exists item_intake_listing_stage_updated_at_idx
on public.item_intake (listing_stage, updated_at desc);
