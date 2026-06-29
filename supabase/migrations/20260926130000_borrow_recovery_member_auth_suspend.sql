-- PR7 : suspension auth manuelle BO (recouvrement emprunt), distincte du ban global.

alter table public.users
  add column if not exists borrow_recovery_suspended_at timestamptz,
  add column if not exists borrow_recovery_suspended_by_user_id uuid references public.users (id) on delete set null,
  add column if not exists borrow_recovery_suspend_cart_id uuid references public.carts (id) on delete set null,
  add column if not exists borrow_recovery_suspend_reason text;

comment on column public.users.borrow_recovery_suspended_at is
  'Suspension auth manuelle BO pour dossier emprunt non-retour — plus forte que la modale J+1.';

create index if not exists users_borrow_recovery_suspended_at_idx
  on public.users (borrow_recovery_suspended_at)
  where borrow_recovery_suspended_at is not null;
