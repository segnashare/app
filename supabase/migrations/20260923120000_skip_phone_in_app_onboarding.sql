-- Téléphone retiré du funnel onboarding app. OTP reste au paiement / abo.
-- Recolle les sessions en cours sur l'étape nom.
update public.onboarding_sessions
set current_step = '/onboarding/name'
where status is distinct from 'completed'
  and current_step in ('/onboarding/phone', '/onboarding/phone/verify');
