-- Chat pièce (site + app) ↔ Discord staff threads.

create table if not exists public.item_chat_conversations (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items (id) on delete cascade,
  visitor_id uuid not null,
  user_id uuid null references auth.users (id) on delete set null,
  contact_email text null,
  discord_thread_id text null,
  discord_last_message_id text null,
  source text not null check (source in ('web', 'app')),
  status text not null default 'open' check (status in ('open', 'closed')),
  item_title text null,
  item_size_label text null,
  item_condition_label text null,
  last_message_at timestamptz not null default now(),
  last_read_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists item_chat_conversations_visitor_idx
  on public.item_chat_conversations (visitor_id, last_message_at desc);

create index if not exists item_chat_conversations_user_idx
  on public.item_chat_conversations (user_id, last_message_at desc)
  where user_id is not null;

create index if not exists item_chat_conversations_item_visitor_idx
  on public.item_chat_conversations (item_id, visitor_id, status);

create index if not exists item_chat_conversations_discord_open_idx
  on public.item_chat_conversations (status, discord_thread_id)
  where discord_thread_id is not null and status = 'open';

create table if not exists public.item_chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.item_chat_conversations (id) on delete cascade,
  role text not null check (role in ('visitor', 'staff', 'system')),
  body text not null check (char_length(trim(body)) > 0 and char_length(body) <= 4000),
  discord_message_id text null,
  created_at timestamptz not null default now()
);

create index if not exists item_chat_messages_conversation_idx
  on public.item_chat_messages (conversation_id, created_at asc);

create unique index if not exists item_chat_messages_discord_message_uidx
  on public.item_chat_messages (discord_message_id)
  where discord_message_id is not null;

alter table public.item_chat_conversations enable row level security;
alter table public.item_chat_messages enable row level security;

-- Accès uniquement via service_role (API Next.js). Pas de policies pour anon/authenticated.
