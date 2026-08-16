-- Stable human-readable forwarding aliases, dual-format lookup, and verified-route
-- milestones. Catch-all Email Routing on getcaughtup.io is configured separately;
-- this migration only prepares schema. Do not apply without explicit authorization.
--
-- After this schema is applied and functions are deployed, authorized cutover is:
-- 1) Deploy compatible agent-api, inbound-email, and caughtup-inbound-email.
-- 2) Confirm existing opaque aliases still ingest.
-- 3) Point the getcaughtup.io catch-all at caughtup-inbound-email, keeping reserved exact routes.
-- 4) Verify unknown-address discard and known-user isolation.
-- 5) Assign stable aliases, keep legacy opaque addresses compatible, complete one Gmail replacement.
-- 6) Require a returning external probe before route_verified. Then stop exact-rule provisioning.

alter table public.ia_forwarding_aliases
  add column if not exists alias_slug text,
  add column if not exists legacy_alias_address text,
  add column if not exists google_confirmed_at timestamptz,
  add column if not exists route_verified_at timestamptz;

alter table public.ia_forwarding_aliases
  drop constraint if exists ia_forwarding_aliases_status_check;

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.ia_forwarding_aliases'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ~* 'length\(alias_address\)'
  loop
    execute format('alter table public.ia_forwarding_aliases drop constraint %I', constraint_name);
  end loop;

  for constraint_name in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.ia_forwarding_aliases'::regclass
      and con.contype = 'c'
      and (
        pg_get_constraintdef(con.oid) ~* 'status in'
        or pg_get_constraintdef(con.oid) ~* 'status = ANY'
      )
  loop
    execute format('alter table public.ia_forwarding_aliases drop constraint %I', constraint_name);
  end loop;
end $$;

update public.ia_forwarding_aliases
  set status = 'address_ready'
  where status = 'pending';
update public.ia_forwarding_aliases
  set status = 'google_verification_received'
  where status = 'verification_received';
update public.ia_forwarding_aliases
  set status = 'route_verified',
      route_verified_at = coalesce(route_verified_at, activated_at, updated_at)
  where status = 'active';

alter table public.ia_forwarding_aliases
  add constraint ia_forwarding_aliases_status_check
    check (status in (
      'address_ready',
      'google_verification_received',
      'awaiting_gmail_enable',
      'verifying_route',
      'route_verified',
      'disabled'
    )),
  add constraint ia_forwarding_aliases_alias_address_length_check
    check (length(alias_address) between 6 and 320),
  add constraint ia_forwarding_aliases_slug_format_check
    check (alias_slug is null or alias_slug ~ '^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$'),
  add constraint ia_forwarding_aliases_legacy_address_check
    check (
      legacy_alias_address is null
      or (
        legacy_alias_address = lower(legacy_alias_address)
        and length(legacy_alias_address) between 20 and 320
      )
    );

create unique index if not exists ia_forwarding_aliases_slug_uidx
  on public.ia_forwarding_aliases(alias_slug)
  where alias_slug is not null;
create unique index if not exists ia_forwarding_aliases_legacy_address_uidx
  on public.ia_forwarding_aliases(legacy_alias_address)
  where legacy_alias_address is not null;
create index if not exists ia_forwarding_aliases_address_lookup_idx
  on public.ia_forwarding_aliases(alias_address, status);

alter table public.ia_forwarding_test_runs
  add column if not exists kind text not null default 'controlled_test';

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.ia_forwarding_test_runs'::regclass
      and con.contype = 'c'
      and (
        pg_get_constraintdef(con.oid) ~* 'kind in'
        or pg_get_constraintdef(con.oid) ~* 'kind = ANY'
      )
  loop
    execute format('alter table public.ia_forwarding_test_runs drop constraint %I', constraint_name);
  end loop;
end $$;

alter table public.ia_forwarding_test_runs
  add constraint ia_forwarding_test_runs_kind_check
    check (kind in ('controlled_test', 'route_probe'));

create index if not exists ia_forwarding_test_runs_kind_idx
  on public.ia_forwarding_test_runs(user_id, kind, created_at desc);
