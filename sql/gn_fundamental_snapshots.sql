create table if not exists public.gn_fundamental_snapshots (
 symbol text not null, observed_at timestamptz not null default now(),
 payload jsonb not null, primary key(symbol, observed_at)
);
create index if not exists gn_fundamental_snapshots_latest on public.gn_fundamental_snapshots(symbol,observed_at desc);
alter table public.gn_fundamental_snapshots enable row level security;
revoke all on public.gn_fundamental_snapshots from anon, authenticated;
grant select,insert,delete on public.gn_fundamental_snapshots to service_role;
