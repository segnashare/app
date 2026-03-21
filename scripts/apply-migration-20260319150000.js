const { Client } = require('pg');
const url = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
if (!url) { console.error('Set DATABASE_URL or SUPABASE_DB_URL'); process.exit(1); }
const sql = "alter table public.item_condition_history add column if not exists status text not null default 'draft' check (status in ('draft', 'confirmed')); comment on column public.item_condition_history.status is 'draft=état annoncé en cours de saisie, confirmed=validé';";
const record = "insert into supabase_migrations.schema_migrations (version, name) values ('20260319150000', '20260319150000_item_condition_history_status') on conflict (version) do nothing;";
const client = new Client({ connectionString: url });
client.connect().then(() => client.query(sql)).then(() => client.query(record)).then(() => { console.log('Migration applied'); client.end(); }).catch(e => { console.error(e.message); client.end(); process.exit(1); });
