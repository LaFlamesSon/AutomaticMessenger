-- Phase 1 groundwork: per-user API tokens, chat history, auto-send preference.

alter table ia_users add column if not exists api_token uuid not null unique default gen_random_uuid();
alter table ia_voice_profiles add column if not exists auto_send boolean not null default false;
alter table ia_processed_emails add column if not exists auto_sent boolean not null default false;

create table if not exists ia_chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references ia_users(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists ia_chat_messages_user_idx on ia_chat_messages (user_id, created_at desc);
alter table ia_chat_messages enable row level security;;
