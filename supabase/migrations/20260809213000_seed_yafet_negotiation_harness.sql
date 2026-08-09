-- No-send live negotiation harness for yafet2132@gmail.com.
-- The records are isolated by qa-negotiation:* thread IDs and is_test=true.
-- This migration does not read or mutate Gmail messages, tokens, or auto-send state.

do $$
declare
  target_user_id uuid;
  target_account_id uuid;
  target_kit_id uuid;
  rates ia_media_kit_rate_profiles%rowtype;
  below_flat numeric;
  below_commission numeric;
  range_flat numeric;
  range_commission numeric;
  strong_flat numeric;
  strong_commission numeric;
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

  -- Supply safe demo thresholds only when this kit has not been configured yet.
  -- Existing creator thresholds are never overwritten.
  insert into ia_media_kit_rate_profiles (
    user_id, media_kit_id, currency, flat_fee_floor, flat_fee_target,
    commission_floor, commission_target, hybrid_guarantee_floor,
    negotiation_notes
  ) values (
    target_user_id, target_kit_id, 'USD', 500, 900, 15, 25, 350,
    'Temporary no-send negotiation harness thresholds. Existing profiles are never overwritten.'
  ) on conflict (media_kit_id) do nothing;

  select * into strict rates
    from ia_media_kit_rate_profiles
   where media_kit_id = target_kit_id;

  below_flat := case
    when rates.flat_fee_floor is not null and rates.flat_fee_floor > 0
      then greatest(rates.flat_fee_floor - greatest(rates.flat_fee_floor * 0.25, 50), 0)
    else null
  end;
  below_commission := case
    when rates.commission_floor is not null and rates.commission_floor > 0
      then greatest(rates.commission_floor - 5, 0)
    else null
  end;
  range_flat := case
    when rates.flat_fee_floor is not null and rates.flat_fee_target is not null
      then (rates.flat_fee_floor + rates.flat_fee_target) / 2
    else rates.flat_fee_floor
  end;
  range_commission := case
    when rates.commission_floor is not null and rates.commission_target is not null
      then (rates.commission_floor + rates.commission_target) / 2
    else rates.commission_floor
  end;
  strong_flat := case
    when rates.flat_fee_target is not null then rates.flat_fee_target + 300
    when rates.flat_fee_floor is not null then rates.flat_fee_floor + 500
    else null
  end;
  strong_commission := case
    when rates.commission_target is not null then least(rates.commission_target + 5, 100)
    when rates.commission_floor is not null then least(rates.commission_floor + 10, 100)
    else null
  end;

  insert into ia_negotiations (
    user_id, gmail_account_id, thread_id, brand_name, brand_domain, stage,
    media_kit_id, current_terms, previous_terms, threshold_status,
    attention_level, human_review_required, latest_message_id,
    latest_subject, summary, last_inbound_at, is_test, updated_at
  ) values
  (
    target_user_id, target_account_id, 'qa-negotiation:below-floor-v1',
    'CaughtUp QA Activewear', 'qa-activewear.example', 'countered', target_kit_id,
    jsonb_strip_nulls(jsonb_build_object(
      'detected', true, 'counteroffer', true, 'currency', rates.currency,
      'flat_fee_amount', below_flat, 'commission_rate', below_commission,
      'deliverables', jsonb_build_array('2 short-form videos'),
      'usage_rights', true, 'exclusivity', true, 'deadline', '2026-08-20'
    )),
    jsonb_strip_nulls(jsonb_build_object(
      'detected', true, 'currency', rates.currency,
      'flat_fee_amount', rates.flat_fee_target,
      'commission_rate', rates.commission_target,
      'deliverables', jsonb_build_array('2 short-form videos')
    )),
    case when below_flat is not null or below_commission is not null
      then 'below_minimum' else 'insufficient_evidence' end,
    'critical', true, 'qa-negotiation-message:below-floor-v1',
    '[TEST] Brand counteroffer needs your decision',
    'Simulation: the brand countered below the pinned media kit minimum. No reply or Gmail action was created.',
    now() - interval '5 minutes', true, now() - interval '5 minutes'
  ),
  (
    target_user_id, target_account_id, 'qa-negotiation:within-range-v1',
    'CaughtUp QA Skincare', 'qa-skincare.example', 'negotiating', target_kit_id,
    jsonb_strip_nulls(jsonb_build_object(
      'detected', true, 'counteroffer', true, 'currency', rates.currency,
      'flat_fee_amount', range_flat, 'commission_rate', range_commission,
      'deliverables', jsonb_build_array('1 tutorial video', '3 story frames'),
      'usage_rights', false, 'exclusivity', false, 'deadline', '2026-08-25'
    )),
    jsonb_strip_nulls(jsonb_build_object(
      'detected', true, 'currency', rates.currency,
      'flat_fee_amount', below_flat, 'commission_rate', below_commission,
      'deliverables', jsonb_build_array('1 tutorial video')
    )),
    case when range_flat is not null or range_commission is not null
      then 'within_range' else 'insufficient_evidence' end,
    'critical', true, 'qa-negotiation-message:within-range-v1',
    '[TEST] Terms moved into your acceptable range',
    'Simulation: revised terms now sit between the media kit floor and target. Creator review is still required.',
    now() - interval '12 minutes', true, now() - interval '12 minutes'
  ),
  (
    target_user_id, target_account_id, 'qa-negotiation:strong-offer-v1',
    'CaughtUp QA Tech', 'qa-tech.example', 'offer_received', target_kit_id,
    jsonb_strip_nulls(jsonb_build_object(
      'detected', true, 'counteroffer', false, 'currency', rates.currency,
      'flat_fee_amount', strong_flat, 'commission_rate', strong_commission,
      'deliverables', jsonb_build_array('1 dedicated video'),
      'usage_rights', false, 'exclusivity', false, 'deadline', '2026-09-01'
    )),
    null,
    case when strong_flat is not null or strong_commission is not null
      then 'at_or_above_target' else 'insufficient_evidence' end,
    'critical', true, 'qa-negotiation-message:strong-offer-v1',
    '[TEST] Strong new collaboration offer',
    'Simulation: a new offer meets or exceeds the media kit target. It remains manual-review only.',
    now() - interval '20 minutes', true, now() - interval '20 minutes'
  )
  on conflict (gmail_account_id, thread_id) do update set
    media_kit_id = excluded.media_kit_id,
    current_terms = excluded.current_terms,
    previous_terms = excluded.previous_terms,
    threshold_status = excluded.threshold_status,
    attention_level = 'critical',
    human_review_required = true,
    latest_subject = excluded.latest_subject,
    summary = excluded.summary,
    last_inbound_at = excluded.last_inbound_at,
    is_test = true,
    updated_at = excluded.updated_at;

  insert into ia_negotiation_events (
    negotiation_id, user_id, gmail_message_id, direction, event_type,
    terms, summary, is_test, created_at
  )
  select n.id, n.user_id, n.latest_message_id, 'inbound',
         case when n.stage = 'countered' then 'counteroffer' else 'offer' end,
         n.current_terms, n.summary, true, n.last_inbound_at
    from ia_negotiations n
   where n.gmail_account_id = target_account_id
     and n.thread_id in (
       'qa-negotiation:below-floor-v1',
       'qa-negotiation:within-range-v1',
       'qa-negotiation:strong-offer-v1'
     )
  on conflict (negotiation_id, gmail_message_id) do update set
    terms = excluded.terms,
    summary = excluded.summary,
    is_test = true;
end $$;
