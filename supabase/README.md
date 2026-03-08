# Supabase foundation

## 1) Link project

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
```

## 2) Apply schema

```bash
npx supabase db push
```

## 3) Serve function locally

```bash
npx supabase functions serve onboarding-webhook
```

## 4) Deploy function

```bash
npx supabase functions deploy onboarding-webhook
```

## Notes

- Keep all business/security logic in SQL (RLS + RPC) and functions.
- Frontend should consume only CRUD + RPC endpoints.
