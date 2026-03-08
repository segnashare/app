-- Normalize onboarding checkpoints and enforce allowed routes.
update public.onboarding_sessions
set current_step = '/onboarding/welcome'
where current_step in ('welcome', '/onboarding', '')
   or current_step is null;

alter table public.onboarding_sessions
  alter column current_step set default '/onboarding/welcome';

alter table public.onboarding_sessions
  drop constraint if exists onboarding_sessions_current_step_check;

alter table public.onboarding_sessions
  add constraint onboarding_sessions_current_step_check
  check (current_step in ('/onboarding/welcome', '/onboarding/1', '/onboarding/2', '/onboarding/3', '/onboarding/end'));
