-- eBay uses CaughtUp's application OAuth credentials while each creator supplies
-- only their public eBay Partner Network campaign id. No provider secret is
-- stored in this table.

alter table ia_affiliate_connections
  add column credential_mode text not null default 'user_vault'
    check (credential_mode in ('user_vault', 'app_shared'));

do $$
declare
  previous_check name;
begin
  select constraint_row.conname into previous_check
  from pg_constraint as constraint_row
  where constraint_row.conrelid = 'public.ia_affiliate_connections'::regclass
    and constraint_row.contype = 'c'
    and pg_get_constraintdef(constraint_row.oid) like '%credential_secret_id%'
  limit 1;
  if previous_check is not null then
    execute format('alter table public.ia_affiliate_connections drop constraint %I', previous_check);
  end if;
end
$$;

alter table ia_affiliate_connections
  add constraint ia_affiliate_connections_connected_credentials_check
    check (
      status <> 'connected'
      or credential_mode = 'app_shared'
      or credential_secret_id is not null
    );

alter table ia_affiliate_connections
  add constraint ia_affiliate_connections_ebay_campaign_check
    check (provider <> 'ebay' or external_account_ref ~ '^[0-9]{10}$');
