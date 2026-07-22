-- Owner-scoped contact preferences and internal calendar holds/bookings.
create extension if not exists btree_gist with schema extensions;

create table if not exists ia_calendar_preferences (
  user_id uuid primary key references ia_users(id) on delete cascade,
  contact_mode text not null default 'email_only'
    check (contact_mode in ('email_only', 'scheduled_call', 'phone')),
  phone_number text,
  booking_url text,
  timezone text not null default 'America/Los_Angeles',
  weekly_availability jsonb not null default '[]'::jsonb check (jsonb_typeof(weekly_availability) = 'array'),
  settings_version integer not null default 1 check (settings_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (phone_number is null or phone_number ~ '^\+[1-9][0-9]{7,14}$'),
  check (booking_url is null or booking_url ~ '^https://')
);

create table if not exists ia_bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references ia_users(id) on delete cascade,
  title text not null check (length(title) between 1 and 120),
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text not null default 'held' check (status in ('held', 'booked')),
  request_id text not null check (length(request_id) between 8 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at > start_at),
  unique (user_id, request_id),
  constraint ia_bookings_no_overlap exclude using gist (
    user_id with =,
    tstzrange(start_at, end_at, '[)') with &&
  ) where (status in ('held', 'booked'))
);
create index if not exists ia_bookings_user_start_idx on ia_bookings(user_id, start_at);

alter table ia_calendar_preferences enable row level security;
alter table ia_bookings enable row level security;
revoke all on ia_calendar_preferences, ia_bookings from anon, authenticated;
grant all on ia_calendar_preferences, ia_bookings to service_role;

create or replace function ia_set_calendar_preferences(
  p_user_id uuid,
  p_expected_version integer,
  p_contact_mode text,
  p_phone_number text,
  p_booking_url text,
  p_timezone text,
  p_weekly_availability jsonb
)
returns setof public.ia_calendar_preferences
language plpgsql
security definer
set search_path = ''
as $$
declare changed public.ia_calendar_preferences;
begin
  update public.ia_calendar_preferences
  set contact_mode = p_contact_mode,
      phone_number = p_phone_number,
      booking_url = p_booking_url,
      timezone = p_timezone,
      weekly_availability = p_weekly_availability,
      settings_version = settings_version + 1,
      updated_at = pg_catalog.now()
  where user_id = p_user_id and settings_version = p_expected_version
  returning * into changed;
  if changed.user_id is null then return; end if;

  update public.ia_voice_profiles profile
  set reply_mode = 'draft_only', auto_send = false,
      auto_send_confirmed_at = null, auto_send_policy_version = null,
      settings_version = profile.settings_version + 1, updated_at = pg_catalog.now()
  where profile.user_id = p_user_id;
  return next changed;
end;
$$;

create or replace function ia_create_booking(
  p_user_id uuid,
  p_title text,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_request_id text,
  p_status text
)
returns table (
  id uuid, user_id uuid, title text, start_at timestamptz, end_at timestamptz,
  status text, request_id text, created_at timestamptz, updated_at timestamptz,
  already_exists boolean, idempotency_mismatch boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare created public.ia_bookings;
begin
  select booking.* into created from public.ia_bookings booking
  where booking.user_id = p_user_id and booking.request_id = p_request_id;
  if created.id is not null then
    return query select created.id, created.user_id, created.title, created.start_at,
      created.end_at, created.status, created.request_id, created.created_at,
      created.updated_at, true,
      not (created.title = p_title and created.start_at = p_start_at and
        created.end_at = p_end_at and created.status = p_status);
    return;
  end if;

  begin
    insert into public.ia_bookings (user_id, title, start_at, end_at, request_id, status)
    values (p_user_id, p_title, p_start_at, p_end_at, p_request_id, p_status)
    returning * into created;
  exception
    when exclusion_violation then return;
    when unique_violation then
      select booking.* into created from public.ia_bookings booking
      where booking.user_id = p_user_id and booking.request_id = p_request_id;
      if created.id is null then return; end if;
      return query select created.id, created.user_id, created.title, created.start_at,
        created.end_at, created.status, created.request_id, created.created_at,
        created.updated_at, true,
        not (created.title = p_title and created.start_at = p_start_at and
          created.end_at = p_end_at and created.status = p_status);
      return;
  end;

  update public.ia_voice_profiles profile
  set reply_mode = 'draft_only', auto_send = false,
      auto_send_confirmed_at = null, auto_send_policy_version = null,
      settings_version = profile.settings_version + 1, updated_at = pg_catalog.now()
  where profile.user_id = p_user_id;
  return query select created.id, created.user_id, created.title, created.start_at,
    created.end_at, created.status, created.request_id, created.created_at,
    created.updated_at, false, false;
end;
$$;

create or replace function ia_delete_booking(p_user_id uuid, p_booking_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare deleted_id uuid;
begin
  delete from public.ia_bookings where id = p_booking_id and user_id = p_user_id returning id into deleted_id;
  if deleted_id is not null then
    update public.ia_voice_profiles profile
    set reply_mode = 'draft_only', auto_send = false,
        auto_send_confirmed_at = null, auto_send_policy_version = null,
        settings_version = profile.settings_version + 1, updated_at = pg_catalog.now()
    where profile.user_id = p_user_id;
  end if;
  return deleted_id;
end;
$$;

revoke all on function ia_set_calendar_preferences(uuid, integer, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function ia_create_booking(uuid, text, timestamptz, timestamptz, text, text) from public, anon, authenticated;
revoke all on function ia_delete_booking(uuid, uuid) from public, anon, authenticated;
grant execute on function ia_set_calendar_preferences(uuid, integer, text, text, text, text, jsonb) to service_role;
grant execute on function ia_create_booking(uuid, text, timestamptz, timestamptz, text, text) to service_role;
grant execute on function ia_delete_booking(uuid, uuid) to service_role;
