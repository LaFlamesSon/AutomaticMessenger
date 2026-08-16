-- Persistent, owner-scoped alias inbox archive and provenance-bearing memory.
-- These tables remain service-role-only; authenticated users reach them through
-- the owner-scoped agent-api.

create unique index if not exists ia_gmail_accounts_id_user_uidx
  on public.ia_gmail_accounts(id, user_id);
create unique index if not exists ia_forwarding_aliases_id_user_uidx
  on public.ia_forwarding_aliases(id, user_id);

create table if not exists public.ia_inbox_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.ia_users(id) on delete cascade,
  gmail_account_id uuid not null,
  forwarding_alias_id uuid not null,
  thread_key text not null,
  subject text not null default '',
  participant_addresses text[] not null default array[]::text[],
  sender_domains text[] not null default array[]::text[],
  first_message_at timestamptz not null,
  last_message_at timestamptz not null,
  message_count integer not null default 0 check (message_count >= 0),
  latest_summary text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (gmail_account_id, thread_key),
  unique (id, gmail_account_id, user_id),
  foreign key (gmail_account_id, user_id)
    references public.ia_gmail_accounts(id, user_id) on delete cascade,
  foreign key (forwarding_alias_id, user_id)
    references public.ia_forwarding_aliases(id, user_id) on delete cascade,
  check (length(thread_key) between 1 and 998),
  check (length(subject) <= 500),
  check (cardinality(participant_addresses) <= 50),
  check (cardinality(sender_domains) <= 25),
  check (length(latest_summary) <= 500)
);

create table if not exists public.ia_inbox_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null,
  user_id uuid not null references public.ia_users(id) on delete cascade,
  gmail_account_id uuid not null,
  forwarding_alias_id uuid not null,
  inbound_message_id uuid references public.ia_inbound_messages(id) on delete set null,
  processed_email_id uuid references public.ia_processed_emails(id) on delete set null,
  message_key text not null check (message_key ~ '^[0-9a-f]{64}$'),
  direction text not null check (direction in ('inbound', 'outbound')),
  source text not null check (source in ('forwarded', 'manual_extension', 'auto_send')),
  sender_address text not null default '',
  recipient_addresses text[] not null default array[]::text[],
  sender_domain text not null default '',
  subject text not null default '',
  body_text text not null default '',
  rfc_message_id text not null default '',
  in_reply_to text not null default '',
  references_header text not null default '',
  category text,
  summary text not null default '',
  processing_state text not null default 'received'
    check (processing_state in ('received', 'processed', 'sent', 'error')),
  occurred_at timestamptz not null,
  normalization_version integer not null default 1 check (normalization_version = 1),
  safe_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (gmail_account_id, message_key),
  unique (id, user_id),
  foreign key (thread_id, gmail_account_id, user_id)
    references public.ia_inbox_threads(id, gmail_account_id, user_id) on delete cascade,
  foreign key (gmail_account_id, user_id)
    references public.ia_gmail_accounts(id, user_id) on delete cascade,
  foreign key (forwarding_alias_id, user_id)
    references public.ia_forwarding_aliases(id, user_id) on delete cascade,
  check (length(sender_address) <= 320),
  check (cardinality(recipient_addresses) <= 50),
  check (length(sender_domain) <= 253),
  check (length(subject) <= 500),
  check (length(body_text) <= 100000),
  check (length(rfc_message_id) <= 998),
  check (length(in_reply_to) <= 998),
  check (length(references_header) <= 4000),
  check (category is null or category in ('urgent','action_needed','fyi','low_priority','spam_or_poor_fit')),
  check (length(summary) <= 500)
);

create unique index if not exists ia_inbox_messages_inbound_uidx
  on public.ia_inbox_messages(inbound_message_id)
  where inbound_message_id is not null;
create index if not exists ia_inbox_threads_user_recent_idx
  on public.ia_inbox_threads(user_id, last_message_at desc, id);
create index if not exists ia_inbox_messages_thread_recent_idx
  on public.ia_inbox_messages(user_id, thread_id, occurred_at desc, id);
create index if not exists ia_inbox_messages_sender_recent_idx
  on public.ia_inbox_messages(user_id, sender_domain, occurred_at desc, id)
  where direction = 'inbound';

create table if not exists public.ia_agent_observations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.ia_users(id) on delete cascade,
  kind text not null check (kind in ('niche', 'recurring_brand', 'inquiry_pattern', 'campaign_type', 'missing_information')),
  value_text text not null,
  normalized_value text not null,
  confidence numeric(4,3) not null default 0 check (confidence between 0 and 1),
  status text not null default 'observed' check (status in ('observed', 'proposed', 'confirmed', 'rejected')),
  evidence_count integer not null default 1 check (evidence_count > 0),
  first_observed_at timestamptz not null default now(),
  last_observed_at timestamptz not null default now(),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, kind, normalized_value),
  unique (id, user_id),
  check (length(value_text) between 2 and 160),
  check (length(normalized_value) between 2 and 160)
);

create table if not exists public.ia_agent_observation_evidence (
  observation_id uuid not null,
  message_id uuid not null,
  user_id uuid not null references public.ia_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (observation_id, message_id),
  foreign key (observation_id, user_id)
    references public.ia_agent_observations(id, user_id) on delete cascade,
  foreign key (message_id, user_id)
    references public.ia_inbox_messages(id, user_id) on delete cascade
);

create index if not exists ia_agent_observations_user_status_idx
  on public.ia_agent_observations(user_id, status, last_observed_at desc, id);
create index if not exists ia_agent_observation_evidence_user_idx
  on public.ia_agent_observation_evidence(user_id, observation_id, created_at desc);

create or replace function public.ia_archive_inbox_message(
  p_user_id uuid,
  p_gmail_account_id uuid,
  p_forwarding_alias_id uuid,
  p_thread_key text,
  p_message_key text,
  p_direction text,
  p_source text,
  p_sender_address text,
  p_recipient_addresses text[],
  p_sender_domain text,
  p_subject text,
  p_body_text text,
  p_rfc_message_id text,
  p_in_reply_to text,
  p_references_header text,
  p_category text,
  p_summary text,
  p_processing_state text,
  p_occurred_at timestamptz,
  p_inbound_message_id uuid default null,
  p_processed_email_id uuid default null,
  p_safe_metadata jsonb default '{}'::jsonb
)
returns public.ia_inbox_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  thread_row public.ia_inbox_threads;
  message_row public.ia_inbox_messages;
  participants text[] := array_remove(array_append(coalesce(p_recipient_addresses, array[]::text[]), p_sender_address), '');
  domains text[] := array_remove(array[p_sender_domain], '');
begin
  insert into public.ia_inbox_threads (
    user_id, gmail_account_id, forwarding_alias_id, thread_key, subject,
    participant_addresses, sender_domains, first_message_at, last_message_at, latest_summary
  ) values (
    p_user_id, p_gmail_account_id, p_forwarding_alias_id, p_thread_key, p_subject,
    participants, domains, p_occurred_at, p_occurred_at, coalesce(p_summary, '')
  )
  on conflict (gmail_account_id, thread_key) do update set
    subject = case when excluded.subject <> '' then excluded.subject else public.ia_inbox_threads.subject end,
    participant_addresses = array(
      select distinct item
      from unnest(public.ia_inbox_threads.participant_addresses || excluded.participant_addresses) as item
      where item <> ''
      order by item
      limit 50
    ),
    sender_domains = array(
      select distinct item
      from unnest(public.ia_inbox_threads.sender_domains || excluded.sender_domains) as item
      where item <> ''
      order by item
      limit 25
    ),
    first_message_at = least(public.ia_inbox_threads.first_message_at, excluded.first_message_at),
    last_message_at = greatest(public.ia_inbox_threads.last_message_at, excluded.last_message_at),
    latest_summary = case when excluded.latest_summary <> '' then excluded.latest_summary else public.ia_inbox_threads.latest_summary end,
    updated_at = now()
  returning * into thread_row;

  insert into public.ia_inbox_messages (
    thread_id, user_id, gmail_account_id, forwarding_alias_id, inbound_message_id,
    processed_email_id, message_key, direction, source, sender_address,
    recipient_addresses, sender_domain, subject, body_text, rfc_message_id,
    in_reply_to, references_header, category, summary, processing_state,
    occurred_at, safe_metadata
  ) values (
    thread_row.id, p_user_id, p_gmail_account_id, p_forwarding_alias_id, p_inbound_message_id,
    p_processed_email_id, p_message_key, p_direction, p_source, p_sender_address,
    coalesce(p_recipient_addresses, array[]::text[]), p_sender_domain, p_subject, p_body_text,
    p_rfc_message_id, p_in_reply_to, p_references_header, p_category, coalesce(p_summary, ''),
    p_processing_state, p_occurred_at, coalesce(p_safe_metadata, '{}'::jsonb)
  )
  on conflict (gmail_account_id, message_key) do update set
    inbound_message_id = coalesce(excluded.inbound_message_id, public.ia_inbox_messages.inbound_message_id),
    processed_email_id = coalesce(excluded.processed_email_id, public.ia_inbox_messages.processed_email_id),
    body_text = excluded.body_text,
    category = coalesce(excluded.category, public.ia_inbox_messages.category),
    summary = case when excluded.summary <> '' then excluded.summary else public.ia_inbox_messages.summary end,
    processing_state = excluded.processing_state,
    safe_metadata = public.ia_inbox_messages.safe_metadata || excluded.safe_metadata,
    updated_at = now()
  returning * into message_row;

  update public.ia_inbox_threads set
    message_count = (
      select count(*)::integer from public.ia_inbox_messages
      where thread_id = thread_row.id
    ),
    latest_summary = case when coalesce(p_summary, '') <> '' then p_summary else latest_summary end,
    updated_at = now()
  where id = thread_row.id;

  return message_row;
end;
$$;

create or replace function public.ia_record_agent_observation(
  p_user_id uuid,
  p_message_id uuid,
  p_kind text,
  p_value text,
  p_confidence numeric
)
returns public.ia_agent_observations
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized text;
  observation public.ia_agent_observations;
begin
  if p_kind not in ('niche', 'recurring_brand', 'inquiry_pattern', 'campaign_type', 'missing_information') then
    raise exception 'invalid observation kind';
  end if;
  if not exists (
    select 1 from public.ia_inbox_messages
    where id = p_message_id and user_id = p_user_id and direction = 'inbound'
  ) then
    raise exception 'invalid observation evidence';
  end if;

  normalized := lower(regexp_replace(trim(coalesce(p_value, '')), '\s+', ' ', 'g'));
  if length(normalized) < 2 or length(normalized) > 160 then
    raise exception 'invalid observation value';
  end if;
  if normalized ~* '(auto[- ]?send|permission to send|enable sending|reply rule|system prompt|password|credential|api key|secret)'
     or normalized ~* '([$€£][[:space:]]*[0-9]|(usd|eur|gbp)[[:space:]]*[0-9]|(accepts?|accepted|rejects?|rejected|agreed|declined)|((creator|owner)[[:space:]]+(is[[:space:]]+)?available)|(committed to|guarantees?))'
     or (p_kind <> 'missing_information' and normalized ~* '(^|[^a-z])(price|pricing|rate|fee|budget)([^a-z]|$)') then
    raise exception 'unsafe observation value';
  end if;

  insert into public.ia_agent_observations (
    user_id, kind, value_text, normalized_value, confidence
  ) values (
    p_user_id, p_kind, trim(p_value), normalized, greatest(0, least(1, coalesce(p_confidence, 0)))
  )
  on conflict (user_id, kind, normalized_value) do update set
    value_text = excluded.value_text,
    confidence = greatest(public.ia_agent_observations.confidence, excluded.confidence),
    last_observed_at = now(),
    updated_at = now()
  returning * into observation;

  insert into public.ia_agent_observation_evidence (observation_id, message_id, user_id)
  values (observation.id, p_message_id, p_user_id)
  on conflict do nothing;

  update public.ia_agent_observations as target set
    evidence_count = evidence.total,
    status = case
      when target.status in ('confirmed', 'rejected') then target.status
      when evidence.total > 1 then 'proposed'
      else 'observed'
    end,
    updated_at = now()
  from (
    select count(*)::integer as total
    from public.ia_agent_observation_evidence
    where observation_id = observation.id
  ) as evidence
  where target.id = observation.id
  returning target.* into observation;

  return observation;
end;
$$;

alter table public.ia_inbox_threads enable row level security;
alter table public.ia_inbox_messages enable row level security;
alter table public.ia_agent_observations enable row level security;
alter table public.ia_agent_observation_evidence enable row level security;

revoke all on table public.ia_inbox_threads, public.ia_inbox_messages,
  public.ia_agent_observations, public.ia_agent_observation_evidence
  from anon, authenticated;
grant all on table public.ia_inbox_threads, public.ia_inbox_messages,
  public.ia_agent_observations, public.ia_agent_observation_evidence
  to service_role;
revoke all on function public.ia_record_agent_observation(uuid, uuid, text, text, numeric)
  from public, anon, authenticated;
grant execute on function public.ia_record_agent_observation(uuid, uuid, text, text, numeric)
  to service_role;
revoke all on function public.ia_archive_inbox_message(
  uuid, uuid, uuid, text, text, text, text, text, text[], text, text, text,
  text, text, text, text, text, text, timestamptz, uuid, uuid, jsonb
) from public, anon, authenticated;
grant execute on function public.ia_archive_inbox_message(
  uuid, uuid, uuid, text, text, text, text, text, text[], text, text, text,
  text, text, text, text, text, text, timestamptz, uuid, uuid, jsonb
) to service_role;
