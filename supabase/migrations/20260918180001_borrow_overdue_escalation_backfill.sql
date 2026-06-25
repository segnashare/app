-- Rattrapage : paniers déjà au-delà de J+14 sans litige d'escalade retard.
-- Dépend de 20260918180000 (enum cart_status.disputed).

do $backfill$
declare
  r record;
  v_result jsonb;
  v_calendar date := (timezone('Europe/Paris', now()))::date;
begin
  for r in
    select o.cart_id
    from public.cart_borrow_overdue o
    join public.carts c on c.id = o.cart_id
    where o.status = 'active'::public.cart_borrow_overdue_status
      and c.deleted_at is null
      and c.borrow_return_due_at is not null
      and c.status in ('confirmed'::public.cart_status, 'archived'::public.cart_status)
      and public.resolve_cart_borrow_overdue_late_day(c.borrow_return_due_at, v_calendar) > 14
      and not exists (
        select 1
        from public.cart_disputes cd
        where cd.cart_id = o.cart_id
          and cd.deleted_at is null
          and cd.reason = 'borrow_return_overdue_escalation'
      )
  loop
    v_result := public.accrue_cart_borrow_overdue_day(r.cart_id, v_calendar, false);
    raise notice 'borrow_overdue_escalation_backfill cart=% result=%', r.cart_id, v_result;
  end loop;
end
$backfill$;
