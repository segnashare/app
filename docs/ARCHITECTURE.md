# Segna App Architecture

## Product constraints

- Mobile-first experience (phone format is the default target).
- Frontend talks to Supabase through CRUD only (table CRUD + RPC calls).
- Business logic, security, and data integrity stay in Postgres (RLS + RPC) and Edge Functions.

## Frontend architecture

- `src/app`: routing, layouts, and page-level composition only.
- `src/features/*`: domain modules (`auth`, `onboarding`, etc.).
- `src/components/ui`: reusable primitive components (buttons, inputs, cards, typography).
- `src/components/layout`: app shells, containers, phone frame wrappers.
- `src/lib`: shared technical modules (supabase clients, env, utilities).
- `src/types`: global app-wide types that are not domain-specific.

## Naming conventions

- Components: `PascalCase` and explicit role names (`OnboardingStepCard`, `PhoneViewportShell`).
- Hooks: `useXxx` (`useOnboardingProgress`).
- Server helpers: `verbNoun` (`createSupabaseServerClient`).
- RPC: `snake_case` with action intent (`save_onboarding_progress`).
- SQL migration files: timestamp prefix + intent (`YYYYMMDDHHMMSS_foundation.sql`).

## Data architecture (Supabase)

- `profiles`: user identity and long-lived profile data.
- `onboarding_sessions`: progressive onboarding state, resumable payload.
- RLS rules:
  - users can only read/write rows where `user_id = auth.uid()` (or `id = auth.uid()` for profiles),
  - no anonymous access,
  - service role bypass reserved for trusted backend contexts.
- RPC functions:
  - encapsulate complex writes and validation,
  - provide atomic updates for onboarding state transitions.
- Edge Functions:
  - external integrations, side effects, and async workflows,
  - never expose service-role keys in client apps.

## Delivery workflow

1. Update schema via SQL migration.
2. Generate TypeScript types (`npm run supabase:gen:types`).
3. Consume data through typed client in frontend.
4. Keep pages thin, move behavior to `features/*`.
