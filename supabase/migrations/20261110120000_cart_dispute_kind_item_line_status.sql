-- Litige panier typé + état pièce dans le panier (dégradation / perte partielle).

alter table public.cart_disputes
  add column if not exists kind text;

comment on column public.cart_disputes.kind is
  'Type de dossier : member_location | member_reception | member_borrow | return_intake | borrow_overdue | intake_refusal | other';

update public.cart_disputes
set kind = case
  when reason = 'member_location_report' then 'member_location'
  when reason = 'member_reception_report' then 'member_reception'
  when reason = 'member_borrow_report' then 'member_borrow'
  when reason = 'return_arrival_defect' then 'return_intake'
  when reason like 'borrow_overdue%' or reason = 'borrow_overdue_escalation' then 'borrow_overdue'
  when reason = 'item_refused_fulfillment' or reason like '%refused_fulfillment%' then 'intake_refusal'
  else coalesce(kind, 'other')
end
where kind is null;

create index if not exists cart_disputes_kind_idx
  on public.cart_disputes (kind)
  where deleted_at is null;

alter table public.cart_items
  add column if not exists dispute_line_status text;

comment on column public.cart_items.dispute_line_status is
  'État litige pièce dans le panier : in_dispute | return_to_segna | lost_not_returned | cleared — null = hors litige';
