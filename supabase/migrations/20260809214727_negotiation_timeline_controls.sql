-- Mixed Today timeline controls plus isolated, no-send visual fixtures.

alter table ia_negotiations add column if not exists proposed_reply text;
alter table ia_negotiations add column if not exists dismissed_at timestamptz;
alter table ia_processed_emails add column if not exists is_test boolean not null default false;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ia_processed_emails_test_thread_check') then
    alter table ia_processed_emails add constraint ia_processed_emails_test_thread_check
      check (not is_test or thread_id like 'qa-inbox:%');
  end if;
end $$;

create index if not exists ia_negotiations_visible_idx
  on ia_negotiations(user_id, updated_at desc)
  where human_review_required and dismissed_at is null;

do $$
declare
  target_user_id uuid;
  target_account_id uuid;
  target_kit_id uuid;
begin
  select u.id, ga.id
    into strict target_user_id, target_account_id
    from ia_users u
    join ia_gmail_accounts ga on ga.user_id = u.id
   where lower(ga.gmail_address) = 'yafet2132@gmail.com';

  select mk.id
    into strict target_kit_id
    from ia_media_kits mk
   where mk.user_id = target_user_id
     and mk.status = 'active'
   order by mk.is_default desc, mk.updated_at desc
   limit 1;

  update ia_negotiations set
    proposed_reply = case thread_id
      when 'qa-negotiation:below-floor-v1' then
        'Thanks for the update. I reviewed the revised scope and would like to discuss the compensation, usage rights, and exclusivity before moving forward. Could you share whether there is flexibility in those terms?'
      when 'qa-negotiation:within-range-v1' then
        'Thanks for revising the offer. The structure is closer to what I had in mind. Before I make a decision, could you confirm the final deliverables, usage period, exclusivity terms, and campaign timeline?'
      when 'qa-negotiation:strong-offer-v1' then
        'Thanks for sending this over. The opportunity looks promising. Could you confirm the final deliverables, content usage period, payment schedule, and campaign timeline so I can review the complete scope?'
      else proposed_reply
    end,
    dismissed_at = null,
    last_inbound_at = case thread_id
      when 'qa-negotiation:below-floor-v1' then now() - interval '5 minutes'
      when 'qa-negotiation:within-range-v1' then now() - interval '12 minutes'
      when 'qa-negotiation:strong-offer-v1' then now() - interval '20 minutes'
      else last_inbound_at
    end,
    updated_at = case thread_id
      when 'qa-negotiation:below-floor-v1' then now() - interval '5 minutes'
      when 'qa-negotiation:within-range-v1' then now() - interval '12 minutes'
      when 'qa-negotiation:strong-offer-v1' then now() - interval '20 minutes'
      else updated_at
    end
  where user_id = target_user_id
    and is_test = true
    and thread_id in (
      'qa-negotiation:below-floor-v1',
      'qa-negotiation:within-range-v1',
      'qa-negotiation:strong-offer-v1'
    );

  insert into ia_processed_emails (
    gmail_account_id, gmail_message_id, thread_id, category, sender, subject,
    summary, draft_created, draft_text, auto_sent, delivery_status,
    selected_media_kit_id, human_review_required, processed_at, is_test
  ) values
  (
    target_account_id, 'qa-inbox-message:campaign-brief-v1', 'qa-inbox:campaign-brief-v1',
    'action_needed', 'Maya at Northstar Hydration <maya@northstar-hydration.example>',
    '[TEST] Summer creator campaign brief',
    'A brand introduced a possible summer campaign and asked about creative fit and timing.',
    false,
    'Hi Maya,\n\nThanks for reaching out. The campaign sounds interesting. Could you share the intended deliverables, campaign timeline, usage expectations, and budget range so I can review the complete scope?\n\nBest,\nYafet',
    false, 'none', target_kit_id, true, now() - interval '2 minutes', true
  ),
  (
    target_account_id, 'qa-inbox-message:portfolio-request-v1', 'qa-inbox:portfolio-request-v1',
    'urgent', 'Jordan at Harbor Skin <jordan@harbor-skin.example>',
    '[TEST] Request for media kit and audience details',
    'A skincare brand requested the relevant media kit and more information about the audience.',
    false,
    'Hi Jordan,\n\nThank you for considering me. I can share the relevant media kit. Could you also send the campaign goals, expected deliverables, timeline, and any content usage requirements?\n\nBest,\nYafet',
    false, 'none', target_kit_id, true, now() - interval '8 minutes', true
  ),
  (
    target_account_id, 'qa-inbox-message:shipping-update-v1', 'qa-inbox:shipping-update-v1',
    'fyi', 'Operations at Sample House <updates@sample-house.example>',
    '[TEST] Product sample shipping update',
    'The brand says a sample is being prepared and will provide tracking later. No response is needed.',
    false, null, false, 'none', null, false, now() - interval '15 minutes', true
  )
  on conflict (gmail_account_id, gmail_message_id) do update set
    category = excluded.category,
    sender = excluded.sender,
    subject = excluded.subject,
    summary = excluded.summary,
    draft_created = false,
    draft_text = excluded.draft_text,
    auto_sent = false,
    delivery_status = 'none',
    gmail_draft_id = null,
    selected_media_kit_id = excluded.selected_media_kit_id,
    human_review_required = excluded.human_review_required,
    processed_at = excluded.processed_at,
    is_test = true;
end $$;
