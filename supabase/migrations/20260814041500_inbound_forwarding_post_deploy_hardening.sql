-- Cover inbound ownership/cleanup lookups and close a pre-existing public
-- SECURITY DEFINER grant that is not part of the application API.

create index if not exists ia_inbound_messages_user_created_idx
  on public.ia_inbound_messages(user_id, created_at desc);

create index if not exists ia_inbound_messages_processed_email_idx
  on public.ia_inbound_messages(processed_email_id)
  where processed_email_id is not null;

revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
