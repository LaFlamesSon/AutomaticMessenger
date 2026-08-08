-- Recreate the allocator with the table's actual creation timestamp
-- with an ordering column that exists and preserve its service-role-only ACL.

create or replace function public.ia_surface_daily_affiliate_opportunities(
  p_user_id uuid,
  p_surface_date date,
  p_daily_limit integer default 10
)
returns setof uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_slots integer;
begin
  if p_surface_date is null then
    raise exception 'surface date is required';
  end if;
  if p_daily_limit < 1 or p_daily_limit > 10 then
    raise exception 'daily affiliate limit must be between 1 and 10';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select greatest(0, p_daily_limit - count(*))::integer
  into v_slots
  from public.ia_opportunities
  where user_id = p_user_id
    and opportunity_kind = 'affiliate_product'
    and surfaced_on = p_surface_date;

  if v_slots > 0 then
    with candidates as (
      select id
      from public.ia_opportunities
      where user_id = p_user_id
        and opportunity_kind = 'affiliate_product'
        and status <> 'dismissed'
        and surfaced_on is null
        and creator_relevant
        and platform_eligible
        and match_score >= 30
        and (commission_rate is not null or commission_amount is not null)
      order by match_score desc, created_at desc, id
      limit v_slots
      for update skip locked
    )
    update public.ia_opportunities as opportunity
    set surfaced_at = current_timestamp,
        surfaced_on = p_surface_date,
        updated_at = current_timestamp
    from candidates
    where opportunity.id = candidates.id;
  end if;

  return query
  select opportunity.id
  from public.ia_opportunities as opportunity
  where opportunity.user_id = p_user_id
    and opportunity.opportunity_kind = 'affiliate_product'
    and opportunity.status <> 'dismissed'
    and opportunity.surfaced_on = p_surface_date
  order by opportunity.match_score desc, opportunity.surfaced_at, opportunity.id
  limit p_daily_limit;
end;
$$;

revoke all on function public.ia_surface_daily_affiliate_opportunities(uuid, date, integer) from public, anon, authenticated;
grant execute on function public.ia_surface_daily_affiliate_opportunities(uuid, date, integer) to service_role;
