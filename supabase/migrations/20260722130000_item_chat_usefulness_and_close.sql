-- Feedback utilité (12h idle) + suppression fil Discord (12h après le prompt).

alter table public.item_chat_conversations
  add column if not exists usefulness_prompted_at timestamptz null,
  add column if not exists usefulness_rating text null
    check (usefulness_rating is null or usefulness_rating in ('yes', 'no')),
  add column if not exists discord_thread_deleted_at timestamptz null;

create index if not exists item_chat_conversations_usefulness_due_idx
  on public.item_chat_conversations (status, last_message_at)
  where status = 'open' and usefulness_prompted_at is null;

create index if not exists item_chat_conversations_discord_delete_due_idx
  on public.item_chat_conversations (status, usefulness_prompted_at)
  where status = 'open'
    and usefulness_prompted_at is not null
    and discord_thread_deleted_at is null;
