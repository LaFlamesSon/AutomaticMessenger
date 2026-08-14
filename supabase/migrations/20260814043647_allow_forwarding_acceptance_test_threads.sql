-- Keep synthetic inbox rows isolated to explicit test namespaces while allowing
-- the one-use forwarding acceptance path to persist a non-sendable review card.

alter table public.ia_processed_emails
  drop constraint if exists ia_processed_emails_test_thread_check;

alter table public.ia_processed_emails
  add constraint ia_processed_emails_test_thread_check
  check (not is_test or thread_id like 'qa-inbox:%' or thread_id like 'fwd-test:%');
