# Segna App

Mobile-first onboarding application built with Next.js + Supabase.

## Tech stack

- Next.js (App Router, TypeScript)
- Tailwind CSS
- Supabase (`@supabase/supabase-js`, `@supabase/ssr`)
- React Hook Form + Zod
- TanStack Query

## Setup

1. Copy env file:

```bash
cp .env.example .env.local
```

2. Fill Supabase keys in `.env.local`.

3. Install dependencies:

```bash
npm install
```

4. Start app:

```bash
npm run dev
```

## Supabase commands

```bash
npm run supabase:start
npm run supabase:status
npm run supabase:db:reset
npm run supabase:functions:serve
npm run supabase:gen:types
```

## Architecture docs

- `docs/ARCHITECTURE.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `supabase/README.md`
