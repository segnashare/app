# Implementation Plan

## Phase 1 - Supabase connection

- Create Supabase project and retrieve URL/keys.
- Fill `.env.local`.
- Link local project with Supabase CLI.
- Validate basic connectivity from server and browser clients.

## Phase 2 - Authentication

- Configure auth providers and email templates.
- Build auth pages/flows in `src/features/auth`.
- Add route protection strategy for app sections.

## Phase 3 - Onboarding flow

- Define onboarding steps and field contracts.
- Build step engine (state, validation, save/resume).
- Persist progress through RPC and CRUD reads.

## Phase 4 - Production hardening

- Add audit/retry mechanisms for Edge Functions.
- Add monitoring + logging strategy.
- Add tests (unit + integration + key E2E onboarding path).
