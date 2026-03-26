-- Annulation retour membre: soft-delete de la demande outtake.
alter table public.item_outtake
add column if not exists deleted_at timestamptz;
