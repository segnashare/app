-- Durée d'emprunt par défaut : 30 jours (1 mois) au checkout et en repli SQL Guest.

create or replace function public.trg_carts_default_checkout_borrow_duration_on_confirm()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.status = 'confirmed'::public.cart_status
     and OLD.status is distinct from 'confirmed'::public.cart_status
     and NEW.checkout_borrow_duration_days is null then
    NEW.checkout_borrow_duration_days := 30;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_carts_default_checkout_borrow_duration_on_confirm on public.carts;
create trigger trg_carts_default_checkout_borrow_duration_on_confirm
  before update on public.carts
  for each row
  execute function public.trg_carts_default_checkout_borrow_duration_on_confirm();

comment on function public.trg_carts_default_checkout_borrow_duration_on_confirm() is
  'À la confirmation panier : checkout_borrow_duration_days = 30 si absent.';

create or replace function public.compute_borrow_return_due_at_from_receipt(
  p_receipt_confirmed_at timestamptz,
  p_user_id uuid,
  p_checkout_borrow_duration_days integer default null
)
returns timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_paris_receipt date;
  v_due_date date;
  v_plan text;
  v_status text;
begin
  if p_receipt_confirmed_at is null then
    return null;
  end if;

  v_paris_receipt := (p_receipt_confirmed_at at time zone 'Europe/Paris')::date;

  if p_checkout_borrow_duration_days is not null and p_checkout_borrow_duration_days >= 1 then
    v_due_date := v_paris_receipt + p_checkout_borrow_duration_days;
    return public.borrow_return_due_end_of_paris_day(v_due_date);
  end if;

  select us.plan_code, us.status
    into v_plan, v_status
  from public.user_subscriptions us
  where us.user_id = p_user_id
    and us.provider = 'stripe'
  order by us.updated_at desc nulls last
  limit 1;

  if coalesce(v_status, '') in ('active', 'trialing') and coalesce(v_plan, '') = 'segna_x' then
    v_due_date := v_paris_receipt + 30;
  elsif coalesce(v_status, '') in ('active', 'trialing') and coalesce(v_plan, '') = 'segna_plus' then
    v_due_date := (v_paris_receipt + interval '1 month')::date;
  else
    v_due_date := v_paris_receipt + 30;
  end if;

  return public.borrow_return_due_end_of_paris_day(v_due_date);
end;
$$;

comment on function public.compute_borrow_return_due_at_from_receipt(timestamptz, uuid, integer) is
  'Échéance initiale : jour réception Paris + durée checkout (ou membership legacy), à 23:59:59 Europe/Paris. Guest par défaut : 30 j.';
