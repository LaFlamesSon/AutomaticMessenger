-- Permit a one-use forwarding acceptance run to exercise Auto-send only when
-- its generated reply is forced back to the connected account itself.

alter table public.ia_forwarding_test_runs
  add column allow_auto_send boolean not null default false;
