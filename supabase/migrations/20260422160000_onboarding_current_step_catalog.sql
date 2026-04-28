-- Elargit current_step pour couvrir le funnel « slim » + les étapes profil / ancien parcours
-- encore appelées par upsert_onboarding_progress (ex. /onboarding/profile depuis l’édition position).

alter table public.onboarding_sessions
  drop constraint if exists onboarding_sessions_current_step_check;

alter table public.onboarding_sessions
  add constraint onboarding_sessions_current_step_check
  check (
    current_step in (
      '/onboarding/1',
      '/onboarding/2',
      '/onboarding/3',
      '/onboarding/answers',
      '/onboarding/birth',
      '/onboarding/brands',
      '/onboarding/budget',
      '/onboarding/confidentialite',
      '/onboarding/confidentiality',
      '/onboarding/dressing',
      '/onboarding/end',
      '/onboarding/ethic',
      '/onboarding/experience',
      '/onboarding/interests',
      '/onboarding/location',
      '/onboarding/looks',
      '/onboarding/motivation',
      '/onboarding/name',
      '/onboarding/notifications',
      '/onboarding/package',
      '/onboarding/phone',
      '/onboarding/phone/verify',
      '/onboarding/privacy',
      '/onboarding/profile',
      '/onboarding/share',
      '/onboarding/size',
      '/onboarding/style',
      '/onboarding/subscription',
      '/onboarding/welcome',
      '/onboarding/work'
    )
  );
