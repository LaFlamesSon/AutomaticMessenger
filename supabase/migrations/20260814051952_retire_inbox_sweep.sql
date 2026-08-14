-- Retire the Gmail inbox-reading worker after the forwarding/send-only cutover.
-- The guard prevents removing the capability while any account still depends on it.

do $$
begin
  if exists (
    select 1
    from public.ia_gmail_accounts
    where oauth_capability = 'inbox_read'
  ) then
    raise exception 'cannot retire inbox sweep while inbox_read accounts remain';
  end if;
end
$$;

do $$
declare
  sweep_job_id bigint;
begin
  select jobid
  into sweep_job_id
  from cron.job
  where jobname = 'inbox-agent-sweep';

  if sweep_job_id is not null then
    perform cron.unschedule(sweep_job_id);
  end if;
end
$$;

alter table public.ia_gmail_accounts
  drop constraint if exists ia_gmail_accounts_oauth_capability_check;

alter table public.ia_gmail_accounts
  add constraint ia_gmail_accounts_oauth_capability_check
  check (oauth_capability in ('legacy_disabled', 'send_only'));
