-- Add 38 isolated database-only cards to the existing 17-card Today test set.
-- No Gmail state, tokens, sends, negotiations, or Auto-send settings are touched.

do $$
declare
  target_user_id uuid;
  target_account_id uuid;
  default_kit_id uuid;
  skincare_kit_id uuid;
  eyelash_kit_id uuid;
  fitness_kit_id uuid;
  fashion_kit_id uuid;
  automotive_kit_id uuid;
  finance_kit_id uuid;
  food_kit_id uuid;
  gaming_kit_id uuid;
  home_kit_id uuid;
  travel_kit_id uuid;
begin
  select u.id, ga.id
    into strict target_user_id, target_account_id
    from ia_users u
    join ia_gmail_accounts ga on ga.user_id = u.id
   where lower(ga.gmail_address) = 'yafet2132@gmail.com';

  select id into strict default_kit_id from ia_media_kits
   where user_id = target_user_id and status = 'active' and is_default limit 1;
  select id into strict skincare_kit_id from ia_media_kits
   where user_id = target_user_id and status = 'active' and best_for ilike 'Skincare,%' order by updated_at desc limit 1;
  select id into strict eyelash_kit_id from ia_media_kits
   where user_id = target_user_id and status = 'active' and best_for ilike 'Eyelash,%' order by updated_at desc limit 1;
  select id into strict fitness_kit_id from ia_media_kits
   where user_id = target_user_id and status = 'active' and best_for ilike 'Fitness,%' order by updated_at desc limit 1;
  select id into strict fashion_kit_id from ia_media_kits
   where user_id = target_user_id and status = 'active' and best_for ilike 'Fashion,%' order by updated_at desc limit 1;
  select id into strict automotive_kit_id from ia_media_kits
   where user_id = target_user_id and status = 'active' and best_for ilike 'Automotive,%' order by updated_at desc limit 1;
  select id into strict finance_kit_id from ia_media_kits
   where user_id = target_user_id and status = 'active' and best_for ilike 'Personal finance,%' order by updated_at desc limit 1;
  select id into strict food_kit_id from ia_media_kits
   where user_id = target_user_id and status = 'active' and best_for ilike 'Food,%' order by updated_at desc limit 1;
  select id into strict gaming_kit_id from ia_media_kits
   where user_id = target_user_id and status = 'active' and best_for ilike 'Gaming,%' order by updated_at desc limit 1;
  select id into strict home_kit_id from ia_media_kits
   where user_id = target_user_id and status = 'active' and best_for ilike 'Home decor,%' order by updated_at desc limit 1;
  select id into strict travel_kit_id from ia_media_kits
   where user_id = target_user_id and status = 'active' and best_for ilike 'Travel,%' order by updated_at desc limit 1;

  with fixture_data as (
    select * from jsonb_to_recordset($fixtures$[
      {"slug":"skincare-launch","category":"action_needed","brand":"Luma Derm","subject":"Barrier serum launch brief","summary":"A skincare brand introduced a serum campaign and requested audience and content-fit details.","kit":"skincare"},
      {"slug":"vitamin-c","category":"urgent","brand":"Solace Skin","subject":"Vitamin C creator shortlist","summary":"The brand is finalizing a skincare shortlist and asked for the relevant creator materials.","kit":"skincare"},
      {"slug":"lash-sample","category":"action_needed","brand":"Velvet Lash","subject":"Mascara sample collaboration","summary":"A cosmetics team asked whether a mascara sample campaign fits the creator audience.","kit":"eyelash"},
      {"slug":"activewear-brief","category":"urgent","brand":"Northline Motion","subject":"Activewear campaign brief ready","summary":"An activewear brand shared a creator brief that needs review and follow-up questions.","kit":"fitness"},
      {"slug":"gym-app","category":"action_needed","brand":"RepTrack","subject":"Workout app creator partnership","summary":"A fitness app asked about content formats and audience alignment for a possible partnership.","kit":"fitness"},
      {"slug":"sneaker-launch","category":"action_needed","brand":"Stride House","subject":"Fall sneaker launch introduction","summary":"A footwear brand introduced an upcoming launch and requested creator portfolio details.","kit":"fashion"},
      {"slug":"capsule-wardrobe","category":"urgent","brand":"Edit Studio","subject":"Capsule wardrobe campaign window","summary":"A fashion campaign has a near-term planning window and needs creator review.","kit":"fashion"},
      {"slug":"ev-accessory","category":"action_needed","brand":"VoltRoad","subject":"EV accessory demonstration concept","summary":"An automotive accessories company proposed a product demonstration collaboration.","kit":"automotive"},
      {"slug":"car-care","category":"action_needed","brand":"ClearCoat Lab","subject":"Car-care creator introduction","summary":"A car-care brand requested examples relevant to automotive audiences.","kit":"automotive"},
      {"slug":"budgeting-app","category":"urgent","brand":"PocketPilot","subject":"Budgeting app campaign shortlist","summary":"A finance app is closing its creator shortlist and asked for audience information.","kit":"finance"},
      {"slug":"business-bank","category":"action_needed","brand":"Ledger Bank","subject":"Small-business banking collaboration","summary":"A business banking team introduced an educational content opportunity.","kit":"finance"},
      {"slug":"recipe-campaign","category":"action_needed","brand":"Pantry Lane","subject":"Weeknight recipe campaign","summary":"A food brand requested relevant cooking content examples and audience details.","kit":"food"},
      {"slug":"restaurant-launch","category":"urgent","brand":"Juniper Table","subject":"Restaurant opening creator list","summary":"A restaurant team is finalizing its local creator list for an opening campaign.","kit":"food"},
      {"slug":"streaming-accessory","category":"action_needed","brand":"PixelDock","subject":"Streaming accessory review concept","summary":"A gaming hardware brand introduced a possible creator review campaign.","kit":"gaming"},
      {"slug":"software-beta","category":"urgent","brand":"ClipForge","subject":"Creator software beta invitation","summary":"A software company asked for a quick review of its private creator beta brief.","kit":"gaming"},
      {"slug":"sofa-campaign","category":"action_needed","brand":"Hearth Form","subject":"Modular sofa campaign introduction","summary":"A home brand requested interior-focused portfolio examples.","kit":"home"},
      {"slug":"organization-system","category":"action_needed","brand":"Tidy Grid","subject":"Home organization partnership","summary":"A home organization company asked about a possible demonstration partnership.","kit":"home"},
      {"slug":"hotel-stay","category":"urgent","brand":"Atlas House","subject":"Hotel creator stay inquiry","summary":"A hotel team has a time-sensitive creator stay brief ready for review.","kit":"travel"},
      {"slug":"luggage-launch","category":"action_needed","brand":"Wayfarer Goods","subject":"Carry-on launch collaboration","summary":"A luggage brand requested travel portfolio examples and audience fit.","kit":"travel"},
      {"slug":"broad-intro","category":"action_needed","brand":"Mosaic Collective","subject":"Multi-category creator introduction","summary":"An agency introduced several possible brand campaigns without selecting a category yet.","kit":"general"},
      {"slug":"nonprofit-collab","category":"action_needed","brand":"Bright Future Fund","subject":"Awareness campaign creator inquiry","summary":"A nonprofit asked about creator fit for an upcoming awareness campaign.","kit":"general"},
      {"slug":"beverage-sampler","category":"action_needed","brand":"Citrus Current","subject":"Sparkling beverage sampler","summary":"A beverage brand asked whether a product sampler could fit future content.","kit":"food"},
      {"slug":"skin-shipping","category":"fyi","brand":"Luma Derm","subject":"Serum sample shipment created","summary":"The brand created a shipment and will share tracking later. No response is needed.","kit":null},
      {"slug":"invoice-receipt","category":"fyi","brand":"Ledger Bank","subject":"Creator invoice received","summary":"The finance team confirmed receipt of the creator invoice. No response is needed.","kit":null},
      {"slug":"event-reminder","category":"fyi","brand":"Mosaic Collective","subject":"Campaign webinar reminder","summary":"An automated reminder lists the previously scheduled webinar details.","kit":null},
      {"slug":"press-release","category":"fyi","brand":"PixelDock","subject":"Product announcement press release","summary":"The brand shared a general product announcement with no request for action.","kit":null},
      {"slug":"tracking-update","category":"fyi","brand":"Wayfarer Goods","subject":"Carry-on tracking update","summary":"The shipment is moving through the carrier network. No response is needed.","kit":null},
      {"slug":"assets-received","category":"fyi","brand":"Northline Motion","subject":"Campaign assets uploaded","summary":"The brand confirmed that campaign reference assets are available in its portal.","kit":null},
      {"slug":"contact-window","category":"urgent","brand":"Horizon Audio","subject":"Creator contact window closes soon","summary":"A brand asked the creator to review its campaign details before the planning window closes.","kit":"general"},
      {"slug":"audience-demographics","category":"action_needed","brand":"Solace Skin","subject":"Audience demographics request","summary":"A skincare team requested audience demographics and relevant portfolio materials.","kit":"skincare"},
      {"slug":"usage-rights","category":"urgent","brand":"Mosaic Collective","subject":"Usage-rights language needs review","summary":"An agency sent usage-rights language that requires the creator's attention.","kit":"general"},
      {"slug":"exclusivity-clause","category":"urgent","brand":"Edit Studio","subject":"Exclusivity clause added to brief","summary":"A fashion brief now includes an exclusivity clause that needs creator review.","kit":"fashion"},
      {"slug":"deliverables-question","category":"action_needed","brand":"Brightline Media","subject":"Confirm preferred content formats","summary":"An agency asked which content formats are most relevant before drafting a full scope.","kit":"general"},
      {"slug":"affiliate-structure","category":"urgent","brand":"PocketPilot","subject":"Affiliate structure for review","summary":"A finance app shared a commission structure for review before any agreement.","kit":"finance"},
      {"slug":"sample-address","category":"action_needed","brand":"Velvet Lash","subject":"Sample logistics details requested","summary":"A cosmetics brand requested the creator's preferred next step for sample logistics.","kit":"eyelash"},
      {"slug":"content-timeline","category":"action_needed","brand":"Atlas House","subject":"Travel content timeline questions","summary":"A hotel team asked for clarification about the creator's production process.","kit":"travel"},
      {"slug":"skincare-kit-request","category":"urgent","brand":"Harbor Skin","subject":"Skincare media kit requested","summary":"A skincare brand requested the most relevant media kit for an active creator review.","kit":"skincare"},
      {"slug":"creator-call-invite","category":"action_needed","brand":"Signal House","subject":"Creator introduction call invitation","summary":"An agency proposed an introductory conversation and supplied an email follow-up path.","kit":"general"}
    ]$fixtures$::jsonb) as x(slug text, category text, brand text, subject text, summary text, kit text)
  ), numbered as (
    select x.*, row_number() over (order by slug) as row_number
      from fixture_data x
  ), bounded as (
    select n.* from numbered n join generate_series(1, 38) g on g = n.row_number
  )
  insert into ia_processed_emails (
    gmail_account_id, gmail_message_id, thread_id, category, sender, subject,
    summary, draft_created, draft_text, auto_sent, delivery_status,
    selected_media_kit_id, negotiation_id, human_review_required, processed_at, is_test
  )
  select target_account_id,
    'qa-inbox-message:visual-v2:' || slug,
    'qa-inbox:visual-v2:' || slug,
    category,
    brand || ' <hello@' || slug || '.example>',
    '[TEST] ' || subject,
    summary,
    false, null, false, 'none',
    case kit
      when 'skincare' then skincare_kit_id
      when 'eyelash' then eyelash_kit_id
      when 'fitness' then fitness_kit_id
      when 'fashion' then fashion_kit_id
      when 'automotive' then automotive_kit_id
      when 'finance' then finance_kit_id
      when 'food' then food_kit_id
      when 'gaming' then gaming_kit_id
      when 'home' then home_kit_id
      when 'travel' then travel_kit_id
      when 'general' then default_kit_id
      else null
    end,
    null,
    category <> 'fyi',
    now() - ((row_number * 35) || ' seconds')::interval,
    true
  from bounded
  on conflict (gmail_account_id, gmail_message_id) do update set
    category = excluded.category,
    sender = excluded.sender,
    subject = excluded.subject,
    summary = excluded.summary,
    draft_created = false,
    draft_text = null,
    auto_sent = false,
    delivery_status = 'none',
    gmail_draft_id = null,
    gmail_draft_message_id = null,
    gmail_sent_message_id = null,
    sent_via = null,
    sent_at = null,
    selected_media_kit_id = excluded.selected_media_kit_id,
    negotiation_id = null,
    human_review_required = excluded.human_review_required,
    processed_at = excluded.processed_at,
    is_test = true;
end $$;
