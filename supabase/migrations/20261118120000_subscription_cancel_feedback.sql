-- Raisons d’annulation d’abonnement (survey membre) + clamp échéance location à la fin de période.

create table if not exists public.subscription_cancel_feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'stripe' check (provider in ('stripe')),
  provider_subscription_id text,
  plan_code text,
  reason_code text not null,
  reason_label text not null,
  cancel_mode text not null default 'at_period_end'
    check (cancel_mode in ('at_period_end', 'immediate')),
  period_end_at timestamptz,
  source text not null default 'member_app'
    check (source in ('member_app', 'backoffice', 'stripe_portal', 'webhook')),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists subscription_cancel_feedback_created_at_idx
  on public.subscription_cancel_feedback (created_at desc);

create index if not exists subscription_cancel_feedback_reason_code_idx
  on public.subscription_cancel_feedback (reason_code);

create index if not exists subscription_cancel_feedback_user_id_idx
  on public.subscription_cancel_feedback (user_id);

comment on table public.subscription_cancel_feedback is
  'Réponses au questionnaire « Renoncer à l’abonnement » (analytics Management Board).';

alter table public.subscription_cancel_feedback enable row level security;

drop policy if exists subscription_cancel_feedback_admin_all on public.subscription_cancel_feedback;
create policy subscription_cancel_feedback_admin_all
  on public.subscription_cancel_feedback
  for all
  to authenticated
  using (public.billing_is_admin())
  with check (public.billing_is_admin());

grant select, insert on public.subscription_cancel_feedback to service_role;
grant select on public.subscription_cancel_feedback to authenticated;

-- À la réception : ne jamais dépasser la fin de période si annulation programmée.
create or replace function public.trg_carts_set_borrow_return_due_on_receipt()
returns trigger
language plpgsql
security definer
set search_path to public
as $function$
declare
  v_base timestamptz;
  v_ext integer;
  v_due timestamptz;
  v_period_end timestamptz;
  v_cancel_at_period_end boolean;
begin
  if NEW.member_receipt_confirmed_at is not null
     and OLD.member_receipt_confirmed_at is null then
    v_base := public.compute_borrow_return_due_at_from_receipt(
      NEW.member_receipt_confirmed_at,
      NEW.user_id,
      NEW.checkout_borrow_duration_days
    );
    select coalesce(sum(e.extension_days), 0)::integer
      into v_ext
    from public.cart_borrow_extensions e
    where e.cart_id = NEW.id;
    v_due := public.add_borrow_calendar_days_paris(v_base, v_ext);

    select us.current_period_end, us.cancel_at_period_end
      into v_period_end, v_cancel_at_period_end
    from public.user_subscriptions us
    where us.user_id = NEW.user_id
      and us.provider = 'stripe'
    order by us.updated_at desc nulls last
    limit 1;

    if coalesce(v_cancel_at_period_end, false)
       and v_period_end is not null
       and (v_due is null or v_due > v_period_end) then
      v_due := public.borrow_return_due_end_of_paris_day((v_period_end at time zone 'Europe/Paris')::date);
    end if;

    NEW.borrow_return_due_at := v_due;
  end if;
  return NEW;
end;
$function$;

comment on function public.trg_carts_set_borrow_return_due_on_receipt() is
  'Fige borrow_return_due_at à la réception (+ extensions) ; clamp à current_period_end si cancel_at_period_end.';
