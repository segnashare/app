-- Expand allowed onboarding steps to match the full funnel.
alter table public.onboarding_sessions
  drop constraint if exists onboarding_sessions_current_step_check;

alter table public.onboarding_sessions
  add constraint onboarding_sessions_current_step_check
  check (
    current_step in (
      '/onboarding/welcome',
      '/onboarding/phone',
      '/onboarding/phone/verify',
      '/onboarding/name',
      '/onboarding/birth',
      '/onboarding/notifications',
      '/onboarding/1',
      '/onboarding/location',
      '/onboarding/profile',
      '/onboarding/style',
      '/onboarding/brands',
      '/onboarding/size',
      '/onboarding/work',
      '/onboarding/2',
      '/onboarding/motivation',
      '/onboarding/experience',
      '/onboarding/share',
      '/onboarding/budget',
      '/onboarding/dressing',
      '/onboarding/ethic',
      '/onboarding/privacy',
      '/onboarding/confidentiality',
      '/onboarding/confidentialite',
      '/onboarding/3',
      '/onboarding/looks',
      '/onboarding/answers',
      '/onboarding/subscription',
      '/onboarding/package',
      '/onboarding/end'
    )
  );
