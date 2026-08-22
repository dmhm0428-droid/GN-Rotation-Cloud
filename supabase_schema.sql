
-- GN Rotation Cloud v4
-- Supabase SQL Editor에서 한 번만 실행

create extension if not exists pgcrypto;

create table if not exists public.gn_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  error text,
  btc_dominance numeric,
  macro_score numeric,
  source_status jsonb not null default '{}'::jsonb
);

create table if not exists public.gn_snapshots (
  id bigserial primary key,
  run_id uuid not null references public.gn_runs(id) on delete cascade,
  ts timestamptz not null default now(),
  coin text not null check (coin in ('BTC','ETH','SOL','LINK')),
  rank integer,
  score numeric not null,
  stage text not null,
  chase boolean not null default false,
  krw_price numeric,
  usd_price numeric,
  rs4 numeric,
  rs24 numeric,
  cvd15 numeric,
  cvd_complete boolean,
  aggtrade_count integer,
  oi numeric,
  oi15 numeric,
  oi1h numeric,
  funding numeric,
  coinbase_premium_proxy numeric,
  btc_dominance numeric,
  dom15_pp numeric,
  dom1h_pp numeric,
  macro_score numeric,
  delta_score15 numeric,
  data_quality numeric not null default 0,
  components jsonb not null default '{}'::jsonb,
  source_errors jsonb not null default '{}'::jsonb
);

create index if not exists gn_snapshots_coin_ts_idx on public.gn_snapshots (coin, ts desc);
create index if not exists gn_snapshots_ts_idx on public.gn_snapshots (ts desc);
create index if not exists gn_runs_started_idx on public.gn_runs (started_at desc);

create table if not exists public.gn_overlays (
  id integer primary key check (id=1),
  etf jsonb not null default '{"BTC":5,"ETH":5,"SOL":5,"LINK":5}'::jsonb,
  events jsonb not null default '{"BTC":5,"ETH":5,"SOL":5,"LINK":5}'::jsonb,
  note text not null default '중립값. ChatGPT 이벤트 감시 결과가 있을 때만 보정.',
  updated_at timestamptz not null default now()
);

insert into public.gn_overlays(id) values (1)
on conflict (id) do nothing;

create table if not exists public.gn_alerts (
  id bigserial primary key,
  ts timestamptz not null default now(),
  coin text not null,
  level text not null,
  score numeric,
  stage text,
  message text not null,
  snapshot_id bigint references public.gn_snapshots(id) on delete set null
);

create index if not exists gn_alerts_ts_idx on public.gn_alerts (ts desc);

-- Read-only AI analysis results. Raw prompts/responses and API keys are never stored.
create table if not exists public.gn_ai_analyses (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  source_snapshot_ts timestamptz,
  provider text not null check (provider in ('perplexity','xai','deepseek')),
  model text not null,
  status text not null check (status in ('success','disabled','skipped','error')),
  summary text,
  sentiment text check (sentiment is null or sentiment in ('risk_off','neutral','risk_on')),
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  signals jsonb not null default '[]'::jsonb,
  usage jsonb not null default '{}'::jsonb,
  cost_usd numeric,
  error_code text,
  constraint ai_analysis_no_raw_fields check (
    not (usage ?| array['prompt','request','response','raw','api_key'])
  )
);

create index if not exists gn_ai_analyses_created_idx on public.gn_ai_analyses (created_at desc);
create index if not exists gn_ai_analyses_provider_created_idx on public.gn_ai_analyses (provider, created_at desc);

-- 브라우저에서 DB를 직접 공개하지 않는다.
alter table public.gn_runs enable row level security;
alter table public.gn_snapshots enable row level security;
alter table public.gn_overlays enable row level security;
alter table public.gn_alerts enable row level security;
alter table public.gn_ai_analyses enable row level security;

revoke all on public.gn_runs from anon, authenticated;
revoke all on public.gn_snapshots from anon, authenticated;
revoke all on public.gn_overlays from anon, authenticated;
revoke all on public.gn_alerts from anon, authenticated;
revoke all on public.gn_ai_analyses from anon, authenticated;

grant all on public.gn_runs to service_role;
grant all on public.gn_snapshots to service_role;
grant all on public.gn_overlays to service_role;
grant all on public.gn_alerts to service_role;
grant all on public.gn_ai_analyses to service_role;
grant usage, select on all sequences in schema public to service_role;
