-- GN ENTRY readiness V54
-- Purpose: keep readiness aligned to the freshest shadow scan instead of stale pre-pump snapshots.
-- Safety: fail closed; stale/inactive AI is not mandatory, but a fresh failing AI blocks ENTRY.

create or replace view public.gn_entry_readiness_v54_raw with (security_invoker=true) as
with latest_shadow as (
  select s.*
  from public.gn_shadow_top3_candidates s
  where s.run_ts = (select max(run_ts) from public.gn_shadow_top3_candidates)
), ai as (
  select a.created_at,a.verdict,a.all_five_ok,a.providers_success,a.evidence_quality,a.conflict_count
  from public.gn_ai_consensus a
  order by a.created_at desc
  limit 1
)
select
  sh.run_ts as ts,
  sh.market,
  sh.rank,
  sh.score,
  case
    when sh.all_gates_ok is true then 'ENTRY'
    when coalesce((sh.details->'precursor'->>'eligible')::boolean,false)
      and coalesce((sh.details->'precursor'->'persistence'->>'repeat_count_30m')::int,0) >= 2 then 'SCOUT'
    else 'DETECTED'
  end as scanner_status,
  sh.price as krw_price,
  p.first_detected_at,
  p.first_detected_price,
  p.recommended_entry_krw,
  p.recommended_entry_low,
  p.recommended_entry_high,
  p.listing_risk,
  sh.rr_ok,
  sh.rr,
  sh.derivatives_ok,
  sh.onchain_ok,
  sh.data_quality_ok,
  (
    coalesce((sh.details->'precursor'->>'eligible')::boolean,false)
    and coalesce((sh.details->'precursor'->'ma_transition'->>'eligible')::boolean,false)
    and coalesce((sh.details->'precursor'->'post_validation'->>'sampled')::boolean,false)
    and not coalesce((sh.details->'precursor'->>'late')::boolean,false)
  ) as recommendation_eligible,
  coalesce(sh.global_spot_ok,false) as global_spot_consensus,
  coalesce((sh.details->'precursor'->'persistence'->>'decay')::boolean,false)
    or coalesce((sh.details->'precursor'->>'late')::boolean,false) as lagging,
  coalesce((sh.details->'precursor'->'persistence'->>'repeat_count_30m')::int,0) as repeat_count,
  coalesce((sh.details->'precursor'->'persistence'->>'top3_count_30m')::int,0) as top3_count_2h,
  coalesce((sh.details->'precursor'->'persistence'->>'consecutive_top3')::int,0) as consecutive_top3,
  coalesce((sh.details->'precursor'->'ma_transition'->>'alignment')::numeric,0) as ma_alignment,
  coalesce((sh.details->'precursor'->'ma_transition'->>'ma20_slope_3h')::numeric,-99) as ma20_slope_3h,
  coalesce((sh.details->'precursor'->'ma_transition'->>'ma50_slope_3h')::numeric,-99) as ma50_slope_3h,
  coalesce((sh.details->'precursor'->'ma_transition'->>'obv_direction_1h')::numeric,-99) as obv_direction_1h,
  coalesce((sh.details->'precursor'->>'volume_accel_5m')::numeric,99) as volume_accel_5m,
  coalesce((sh.details->'precursor'->>'bid_imbalance')::numeric,0.5) as bid_imbalance,
  coalesce((sh.details->'precursor'->>'buy_aggressor_ratio')::numeric,0.5) as buy_aggressor_ratio,
  (a.created_at is not null and now()-a.created_at <= interval '30 minutes' and coalesce(a.providers_success,0)>0) as ai_recent,
  (a.verdict='VERIFIED' and a.all_five_ok is true and coalesce(a.providers_success,0)=5 and coalesce(a.evidence_quality,0)=1 and coalesce(a.conflict_count,0)=0) as ai_pass,
  (
    coalesce((sh.details->'precursor'->>'eligible')::boolean,false)
    and coalesce((sh.details->'precursor'->'ma_transition'->>'eligible')::boolean,false)
    and coalesce((sh.details->'precursor'->'post_validation'->>'sampled')::boolean,false)
    and not coalesce((sh.details->'precursor'->>'late')::boolean,false)
    and coalesce(sh.global_spot_ok,false)
    and not (coalesce((sh.details->'precursor'->'persistence'->>'decay')::boolean,false) or coalesce((sh.details->'precursor'->>'late')::boolean,false))
    and coalesce(sh.data_quality_ok,false)
    and coalesce(sh.rr_ok,false)
    and coalesce(p.listing_risk,'LOW') <> 'HIGH'
    and coalesce((sh.details->'precursor'->'persistence'->>'repeat_count_30m')::int,0) >= 2
    and (coalesce((sh.details->'precursor'->'persistence'->>'top3_count_30m')::int,0) >= 2 or coalesce((sh.details->'precursor'->'persistence'->>'consecutive_top3')::int,0) >= 2)
    and coalesce((sh.details->'precursor'->>'bid_imbalance')::numeric,0.5) >= 0.55
    and coalesce((sh.details->'precursor'->>'buy_aggressor_ratio')::numeric,0.5) >= 0.48
  ) as core_ready,
  (coalesce(sh.derivatives_ok,false)::int + coalesce(sh.onchain_ok,false)::int + (
    a.created_at is not null and now()-a.created_at <= interval '30 minutes'
    and a.verdict='VERIFIED' and a.all_five_ok is true and coalesce(a.providers_success,0)=5 and coalesce(a.evidence_quality,0)=1 and coalesce(a.conflict_count,0)=0
  )::int) as external_confirmation_count,
  (
    coalesce((sh.details->'precursor'->>'eligible')::boolean,false)
    and coalesce((sh.details->'precursor'->'ma_transition'->>'eligible')::boolean,false)
    and coalesce((sh.details->'precursor'->'post_validation'->>'sampled')::boolean,false)
    and not coalesce((sh.details->'precursor'->>'late')::boolean,false)
    and coalesce(sh.global_spot_ok,false)
    and not (coalesce((sh.details->'precursor'->'persistence'->>'decay')::boolean,false) or coalesce((sh.details->'precursor'->>'late')::boolean,false))
    and coalesce(sh.data_quality_ok,false)
    and coalesce(sh.rr_ok,false)
    and coalesce(p.listing_risk,'LOW') <> 'HIGH'
    and coalesce((sh.details->'precursor'->'persistence'->>'repeat_count_30m')::int,0) >= 2
    and (coalesce((sh.details->'precursor'->'persistence'->>'top3_count_30m')::int,0) >= 2 or coalesce((sh.details->'precursor'->'persistence'->>'consecutive_top3')::int,0) >= 2)
    and coalesce((sh.details->'precursor'->>'bid_imbalance')::numeric,0.5) >= 0.55
    and coalesce((sh.details->'precursor'->>'buy_aggressor_ratio')::numeric,0.5) >= 0.48
    and not (
      a.created_at is not null and now()-a.created_at <= interval '30 minutes'
      and not (a.verdict='VERIFIED' and a.all_five_ok is true and coalesce(a.providers_success,0)=5 and coalesce(a.evidence_quality,0)=1 and coalesce(a.conflict_count,0)=0)
    )
    and (coalesce(sh.derivatives_ok,false) or coalesce(sh.onchain_ok,false) or (
      a.created_at is not null and now()-a.created_at <= interval '30 minutes'
      and a.verdict='VERIFIED' and a.all_five_ok is true and coalesce(a.providers_success,0)=5 and coalesce(a.evidence_quality,0)=1 and coalesce(a.conflict_count,0)=0
    ))
  ) as entry_ready,
  case
    when not (coalesce((sh.details->'precursor'->>'eligible')::boolean,false)
      and coalesce((sh.details->'precursor'->'ma_transition'->>'eligible')::boolean,false)
      and coalesce((sh.details->'precursor'->'post_validation'->>'sampled')::boolean,false)
      and not coalesce((sh.details->'precursor'->>'late')::boolean,false)) then 'EMPIRICAL_NOT_READY'
    when not coalesce(sh.global_spot_ok,false) then 'GLOBAL_SPOT_NOT_READY'
    when not coalesce(sh.data_quality_ok,false) then 'DATA_QUALITY_NOT_READY'
    when not coalesce(sh.rr_ok,false) then 'RR_NOT_READY'
    when coalesce((sh.details->'precursor'->'persistence'->>'repeat_count_30m')::int,0) < 2 then 'REPEAT_NOT_READY'
    when not (coalesce((sh.details->'precursor'->'persistence'->>'top3_count_30m')::int,0) >= 2 or coalesce((sh.details->'precursor'->'persistence'->>'consecutive_top3')::int,0) >= 2) then 'PERSISTENCE_NOT_READY'
    when coalesce((sh.details->'precursor'->>'bid_imbalance')::numeric,0.5) < 0.55 or coalesce((sh.details->'precursor'->>'buy_aggressor_ratio')::numeric,0.5) < 0.48 then 'MICROSTRUCTURE_NOT_READY'
    when a.created_at is not null and now()-a.created_at <= interval '30 minutes' and not (a.verdict='VERIFIED' and a.all_five_ok is true and coalesce(a.providers_success,0)=5 and coalesce(a.evidence_quality,0)=1 and coalesce(a.conflict_count,0)=0) then 'FRESH_AI_BLOCK'
    when not (coalesce(sh.derivatives_ok,false) or coalesce(sh.onchain_ok,false) or (a.created_at is not null and now()-a.created_at <= interval '30 minutes' and a.verdict='VERIFIED' and a.all_five_ok is true and coalesce(a.providers_success,0)=5 and coalesce(a.evidence_quality,0)=1 and coalesce(a.conflict_count,0)=0)) then 'EXTERNAL_CONFIRMATION_WAIT'
    else 'ENTRY_READY'
  end as readiness_reason
from latest_shadow sh
left join lateral (
  select p.* from public.gn_pre_pump_snapshots p
  where p.market=sh.market and p.ts <= sh.run_ts and p.ts >= sh.run_ts - interval '2 hours'
  order by p.ts desc limit 1
) p on true
left join ai a on true;

create or replace view public.gn_entry_readiness_v54 with (security_invoker=true) as
select * from public.gn_entry_readiness_v54_raw
where ts >= now() - interval '12 minutes';
