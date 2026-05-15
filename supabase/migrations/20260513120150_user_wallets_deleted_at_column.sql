-- Soft-delete sur portefeuilles (colonnes attendues par les RPC wallet après 20260513120100).

alter table public.user_wallets
  add column if not exists deleted_at timestamptz null;
