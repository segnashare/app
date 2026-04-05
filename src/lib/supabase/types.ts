/**
 * Types Supabase partagés par le client.
 *
 * `Database` est volontairement large : une définition stricte doit venir de
 * `npx supabase gen types typescript --project-id <ref> > src/lib/supabase/types.ts`
 * (ou `--local`), sinon les inférences `.from()` / `.select()` se cassent.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- en attendant types générés depuis la DB
export type Database = any;
