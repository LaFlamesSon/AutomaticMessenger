-- Replace the restricted Gmail connection with an explicit send-only
-- capability. Existing tokens are disabled until their owner reconnects with
-- the new client; they must never be passed to the inbox-reading worker.

alter table public.ia_gmail_accounts
  add column if not exists oauth_capability text;

update public.ia_gmail_accounts
set oauth_capability = 'legacy_disabled'
where oauth_capability is null;

alter table public.ia_gmail_accounts
  alter column oauth_capability set default 'legacy_disabled',
  alter column oauth_capability set not null;

alter table public.ia_gmail_accounts
  drop constraint if exists ia_gmail_accounts_oauth_capability_check;

alter table public.ia_gmail_accounts
  add constraint ia_gmail_accounts_oauth_capability_check
  check (oauth_capability in ('legacy_disabled', 'send_only', 'inbox_read'));

create index if not exists ia_gmail_accounts_capability_idx
  on public.ia_gmail_accounts (oauth_capability, user_id);

do $$
begin
  if (
    select count(*)
    from vault.secrets
    where name in ('ia_google_send_probe_client_id', 'ia_google_send_probe_client_secret')
  ) <> 2 then
    raise exception 'send-only Gmail OAuth client is not fully configured';
  end if;
end
$$;

-- These exact Vault entries belong to the retired restricted-scope client.
delete from vault.secrets
where name in ('ia_google_client_id', 'ia_google_client_secret');

-- Promote the already-tested send-only client into its permanent production
-- names without exposing or rewriting either secret value.
delete from vault.secrets
where name in ('ia_google_send_client_id', 'ia_google_send_client_secret');

select vault.update_secret(id, null, 'ia_google_send_client_id', 'CaughtUp production Gmail send-only OAuth client ID')
from vault.secrets
where name = 'ia_google_send_probe_client_id';

select vault.update_secret(id, null, 'ia_google_send_client_secret', 'CaughtUp production Gmail send-only OAuth client secret')
from vault.secrets
where name = 'ia_google_send_probe_client_secret';

delete from vault.secrets
where name in ('ia_google_send_probe_email', 'ia_google_send_probe_enabled');
