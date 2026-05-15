-- Colonnes audit sur activity_events (202603100950 ne les crée pas ; 202603111155 y pose des FK).
-- Fichier séparé : 20260311114000 peut déjà être enregistrée comme appliquée sur une remote
-- avant l’ajout de ces ALTER — une migration nouvelle garantit l’exécution.

alter table public.activity_events
  add column if not exists actor_user_id uuid;

alter table public.activity_events
  add column if not exists actor_id uuid;

alter table public.activity_events
  add column if not exists actor_role text;

alter table public.activity_events
  add column if not exists entity_type text;

alter table public.activity_events
  add column if not exists entity_id uuid;

alter table public.activity_events
  add column if not exists action text;

alter table public.activity_events
  add column if not exists metadata jsonb;
