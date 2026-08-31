-- Stripe subscription foundation. Source-only until an explicitly authorized
-- production migration and billing launch.

create table if not exists public.ia_subscriptions (
  user_id uuid primary key references public.ia_users(id) on delete cascade,
  provider text not null default 'stripe' check (provider = 'stripe'),
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_checkout_session_id text,
  stripe_price_id text,
  status text not null default 'not_started' check (status in (
    'not_started', 'checkout_pending', 'incomplete', 'incomplete_expired',
    'trialing', 'active', 'past_due', 'unpaid', 'paused', 'canceled'
  )),
  cancel_at_period_end boolean not null default false,
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_end timestamptz,
  checkout_expires_at timestamptz,
  canceled_at timestamptz,
  ended_at timestamptz,
  last_invoice_id text,
  last_payment_at timestamptz,
  last_invoice_event_created_at timestamptz,
  last_event_created_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (current_period_end is null or current_period_start is null or current_period_end >= current_period_start)
);

create unique index if not exists ia_subscriptions_stripe_customer_uidx
  on public.ia_subscriptions(stripe_customer_id) where stripe_customer_id is not null;
create unique index if not exists ia_subscriptions_stripe_subscription_uidx
  on public.ia_subscriptions(stripe_subscription_id) where stripe_subscription_id is not null;
create unique index if not exists ia_subscriptions_stripe_checkout_session_uidx
  on public.ia_subscriptions(stripe_checkout_session_id) where stripe_checkout_session_id is not null;
create index if not exists ia_subscriptions_status_period_idx
  on public.ia_subscriptions(status, current_period_end) where status <> 'canceled';

create table if not exists public.ia_stripe_events (
  event_id text primary key,
  event_type text not null,
  object_id text,
  livemode boolean not null,
  provider_created_at timestamptz not null,
  status text not null default 'processing' check (status in ('processing', 'processed', 'failed')),
  attempt_count integer not null default 1 check (attempt_count > 0),
  locked_at timestamptz not null default now(),
  processed_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ia_stripe_events_status_locked_idx
  on public.ia_stripe_events(status, locked_at);

create table if not exists public.ia_billing_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.ia_users(id) on delete cascade,
  stripe_event_id text not null references public.ia_stripe_events(event_id) on delete cascade,
  kind text not null check (kind in (
    'trial_ending', 'renewal_upcoming', 'payment_failed',
    'payment_action_required', 'subscription_canceled'
  )),
  status text not null default 'pending' check (status in ('pending', 'acknowledged', 'canceled')),
  due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (stripe_event_id, kind)
);

create index if not exists ia_billing_notifications_user_status_due_idx
  on public.ia_billing_notifications(user_id, status, due_at);

alter table public.ia_subscriptions enable row level security;
alter table public.ia_stripe_events enable row level security;
alter table public.ia_billing_notifications enable row level security;

revoke all on table public.ia_subscriptions,
  public.ia_stripe_events,
  public.ia_billing_notifications
from public, anon, authenticated;

grant all on table public.ia_subscriptions,
  public.ia_stripe_events,
  public.ia_billing_notifications
to service_role;

create or replace function public.ia_claim_stripe_event(
  p_event_id text,
  p_event_type text,
  p_object_id text,
  p_livemode boolean,
  p_provider_created_at timestamptz
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  claimed_event_id text;
begin
  if coalesce(length(p_event_id), 0) < 5 or coalesce(length(p_event_type), 0) < 3 then
    raise exception 'invalid stripe event identity';
  end if;

  insert into public.ia_stripe_events as events (
    event_id, event_type, object_id, livemode, provider_created_at,
    status, attempt_count, locked_at, updated_at
  ) values (
    p_event_id, p_event_type, p_object_id, p_livemode, p_provider_created_at,
    'processing', 1, now(), now()
  )
  on conflict (event_id) do update set
    event_type = excluded.event_type,
    object_id = excluded.object_id,
    livemode = excluded.livemode,
    provider_created_at = excluded.provider_created_at,
    status = 'processing',
    attempt_count = events.attempt_count + 1,
    locked_at = now(),
    processed_at = null,
    error_code = null,
    updated_at = now()
  where events.status = 'failed'
    or (events.status = 'processing' and events.locked_at < now() - interval '10 minutes')
  returning events.event_id into claimed_event_id;

  return claimed_event_id is not null;
end;
$$;

revoke all on function public.ia_claim_stripe_event(text, text, text, boolean, timestamptz)
from public, anon, authenticated;
grant execute on function public.ia_claim_stripe_event(text, text, text, boolean, timestamptz)
to service_role;

create or replace function public.ia_apply_subscription_state(
  p_user_id uuid,
  p_customer_id text,
  p_subscription_id text,
  p_price_id text,
  p_status text,
  p_cancel_at_period_end boolean,
  p_current_period_start timestamptz,
  p_current_period_end timestamptz,
  p_trial_end timestamptz,
  p_canceled_at timestamptz,
  p_ended_at timestamptz,
  p_last_invoice_id text,
  p_last_payment_at timestamptz,
  p_event_created_at timestamptz,
  p_entitled boolean
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  applied_user_id uuid;
begin
  if p_status not in (
    'not_started', 'checkout_pending', 'incomplete', 'incomplete_expired',
    'trialing', 'active', 'past_due', 'unpaid', 'paused', 'canceled'
  ) then
    raise exception 'invalid subscription status';
  end if;

  insert into public.ia_subscriptions as subscriptions (
    user_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, status,
    cancel_at_period_end, current_period_start, current_period_end, trial_end,
    canceled_at, ended_at, last_invoice_id, last_payment_at,
    last_event_created_at, updated_at
  ) values (
    p_user_id, p_customer_id, p_subscription_id, p_price_id, p_status,
    coalesce(p_cancel_at_period_end, false), p_current_period_start, p_current_period_end, p_trial_end,
    p_canceled_at, p_ended_at, p_last_invoice_id, p_last_payment_at,
    p_event_created_at, now()
  )
  on conflict (user_id) do update set
    stripe_customer_id = coalesce(excluded.stripe_customer_id, subscriptions.stripe_customer_id),
    stripe_subscription_id = coalesce(excluded.stripe_subscription_id, subscriptions.stripe_subscription_id),
    stripe_price_id = coalesce(excluded.stripe_price_id, subscriptions.stripe_price_id),
    status = excluded.status,
    cancel_at_period_end = excluded.cancel_at_period_end,
    current_period_start = coalesce(excluded.current_period_start, subscriptions.current_period_start),
    current_period_end = coalesce(excluded.current_period_end, subscriptions.current_period_end),
    trial_end = coalesce(excluded.trial_end, subscriptions.trial_end),
    canceled_at = coalesce(excluded.canceled_at, subscriptions.canceled_at),
    ended_at = coalesce(excluded.ended_at, subscriptions.ended_at),
    last_invoice_id = coalesce(excluded.last_invoice_id, subscriptions.last_invoice_id),
    last_payment_at = coalesce(excluded.last_payment_at, subscriptions.last_payment_at),
    last_event_created_at = excluded.last_event_created_at,
    updated_at = now()
  where subscriptions.last_event_created_at is null
    or excluded.last_event_created_at >= subscriptions.last_event_created_at
  returning subscriptions.user_id into applied_user_id;

  if applied_user_id is null then return false; end if;

  update public.ia_users
  set plan = case when p_entitled then 'pro' else 'free' end,
      stripe_customer_id = coalesce(p_customer_id, stripe_customer_id)
  where id = p_user_id;
  return true;
end;
$$;

revoke all on function public.ia_apply_subscription_state(
  uuid, text, text, text, text, boolean, timestamptz, timestamptz,
  timestamptz, timestamptz, timestamptz, text, timestamptz, timestamptz, boolean
) from public, anon, authenticated;
grant execute on function public.ia_apply_subscription_state(
  uuid, text, text, text, text, boolean, timestamptz, timestamptz,
  timestamptz, timestamptz, timestamptz, text, timestamptz, timestamptz, boolean
) to service_role;

create or replace function public.ia_record_subscription_invoice(
  p_user_id uuid,
  p_invoice_id text,
  p_paid_at timestamptz,
  p_event_created_at timestamptz
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  updated_user_id uuid;
begin
  if coalesce(length(p_invoice_id), 0) < 5 or p_event_created_at is null then
    raise exception 'invalid stripe invoice identity';
  end if;

  update public.ia_subscriptions
  set last_invoice_id = p_invoice_id,
      last_payment_at = coalesce(p_paid_at, last_payment_at),
      last_invoice_event_created_at = p_event_created_at,
      updated_at = now()
  where user_id = p_user_id
    and (last_invoice_event_created_at is null or p_event_created_at >= last_invoice_event_created_at)
  returning user_id into updated_user_id;

  return updated_user_id is not null;
end;
$$;

revoke all on function public.ia_record_subscription_invoice(uuid, text, timestamptz, timestamptz)
from public, anon, authenticated;
grant execute on function public.ia_record_subscription_invoice(uuid, text, timestamptz, timestamptz)
to service_role;
