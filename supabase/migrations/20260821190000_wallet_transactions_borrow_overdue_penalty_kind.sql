-- `accrue_cart_borrow_overdue_day` insère kind = borrow_overdue_penalty ; sans cette valeur la RPC
-- échoue (rollback → tables cart_borrow_overdue* restent vides malgré l’UI « Retard »).

alter table public.wallet_transactions
  drop constraint if exists wallet_transactions_kind_check;

alter table public.wallet_transactions
  add constraint wallet_transactions_kind_check
  check (
    kind in (
      'hold',
      'release',
      'debit',
      'credit',
      'borrow_overdue_penalty'
    )
  );

comment on constraint wallet_transactions_kind_check on public.wallet_transactions is
  'Types de mouvements wallet autorisés (dont pénalité retard emprunt).';
