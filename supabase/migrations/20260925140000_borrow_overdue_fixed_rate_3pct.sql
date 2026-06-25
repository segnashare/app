-- Frais de retard : taux fixe 3 % (300 bps), quel que soit le jour de retard.

create or replace function public.borrow_overdue_rate_bps(p_late_day_index integer)
returns integer
language sql
immutable
as $fn$
  select 300;
$fn$;

comment on function public.borrow_overdue_rate_bps(integer) is
  'Taux fixe 3 % de la valeur panier par jour de retard (late_day_index ignoré).';
