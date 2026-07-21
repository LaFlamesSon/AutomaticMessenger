-- Style learning: mark drafts whose sent version we've already compared
alter table ia_processed_emails add column if not exists edit_captured boolean not null default false;
-- Billing foundation
alter table ia_users add column if not exists plan text not null default 'free' check (plan in ('free','trial','pro'));
alter table ia_users add column if not exists stripe_customer_id text;;
