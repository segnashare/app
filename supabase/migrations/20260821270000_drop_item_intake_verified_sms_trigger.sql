-- SMS « intake verified » : uniquement au clic BO (section Vérification), pas de trigger DB / pg_net.

drop trigger if exists trg_item_intake_verified_member_sms on public.item_intake;

drop function if exists public.trg_item_intake_verified_member_sms();
