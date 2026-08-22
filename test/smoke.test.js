const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");

test("collector, market, and server pass Node syntax validation", () => {
  for (const file of ["collector.js", "market.js", "server.js"]) {
    const result = spawnSync(process.execPath, ["--check", path.join(root, "src", file)], {
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
});

test("market module keeps its public API and neutral decision behavior", () => {
  const market = require("../src/market");
  assert.equal(typeof market.collectLiveMarket, "function");
  assert.equal(typeof market.scoreMarket, "function");
  assert.equal(typeof market.fetchJson, "function");

  const decision = market.scoreMarket({});
  assert.equal(decision.score, 50);
  assert.equal(decision.action, "관찰");
  assert.equal(decision.regime, "혼조");
});

test("database schema covers the market snapshot fields used by collector and server", () => {
  const schema = fs.readFileSync(path.join(root, "supabase_schema.sql"), "utf8");
  const required = [
    "gn_market_snapshots", "run_id", "ts", "market_score", "action", "regime", "quality",
    "spot_breadth100", "spot_breadth50", "spot_median100", "spot_vw100",
    "funding_positive", "funding_median", "funding_hot", "btc_taker_ratio",
    "eth_taker_ratio", "leaders", "laggards", "reasons", "components", "source_errors"
  ];
  for (const name of required) assert.match(schema, new RegExp(`\\b${name}\\b`));
  assert.match(schema, /alter table public\.gn_market_snapshots enable row level security/i);
  assert.match(schema, /revoke all on public\.gn_market_snapshots from anon, authenticated/i);
  assert.match(schema, /grant all on public\.gn_market_snapshots to service_role/i);
});

