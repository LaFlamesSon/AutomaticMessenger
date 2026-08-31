-- Retire the pre-Supabase-Auth bearer-token path. All production users were
-- verified as linked to auth.users before this migration was authored.
alter table public.ia_users
  drop column if exists api_token,
  drop column if exists api_token_revoked_at;
