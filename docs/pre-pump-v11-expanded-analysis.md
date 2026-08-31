# GN PIVOT Pre-Pump V11 — Expanded precursor + post-validation

## Objective
Detect a candidate before the expansion candle, keep genuine precursors in TOP3 repeatedly, and reduce false persistence. A single late appearance after a large move is not considered a successful detection.

## Live production engine
Supabase Edge `gn-shadow-top3` uses `V11_TAPE_MA_POSTVAL`.

Pipeline:
1. Full Upbit KRW 1-minute tape relative anomaly (turnover delta and acceleration).
2. Expanded candidate pool instead of only the already-fast movers.
3. 5-minute structure: volume burst, 2-bar acceleration, OBV, higher low, compression, breakout proximity.
4. 1-hour MA transition: MA5/10/20/50/120/200 alignment score, alignment delta, MA compression coil/release, MA20/50 slopes, long-MA reclaim count, full-stack freshness and MA20 stretch.
5. 1-hour classic OBV lead check.
6. Orderbook + aggressor trade microstructure.
7. Persistence quality: TOP3 repetition is rewarded only if price is not decaying and MA/OBV/microstructure remains healthy. Repeated TOP3 with price decay is penalized.
8. Post-validation feedback: completed precursor episodes are aggregated by archetype. Feedback remains neutral until a minimum sample is reached, then applies a bounded positive/negative score adjustment.
9. Late/overextended and volume-spike-without-buying guards.

## Regression patterns used
### TT — early rank-4 miss / MA-stack transition
Stored history first saw TT at 0.257 as rank 4, but it did not become TOP3 until 0.520 after the main expansion. This is the false-negative pattern V11 targets with the expanded pool, 1H MA compression/alignment transition and OBV lead.

### SKR — false persistence
SKR remained TOP3 repeatedly while price decayed materially. Repetition alone is therefore no longer a positive feature. V11 requires healthy persistence and applies a decay penalty when a repeated candidate loses price structure.

### STORJ — reclaim / fast continuation
STORJ entered TOP3 around 62.5 and subsequently reached about 90.1 in the stored observation window. This represents a valid fast-reclaim/continuation family; the engine preserves tape + 5m ignition paths even when the MA-transition archetype is not the dominant signal.

### ZORA — clean early leader
ZORA appeared TOP3 around 9.66 and later reached about 13.9 in the stored window. This is a clean early relative-flow pattern and is retained as a positive regression family.

### FLOCK — weak repeated signal
FLOCK appeared TOP3 near 59.5 but the stored window later printed roughly 9% lower. This is used as an additional false-positive family for persistence-quality and post-validation checks.

## Mandatory post-validation
`gn-precursor-validator` V2 records 15m, 30m, 1h, 3h, 4h and 24h returns, 3h/24h MFE/MAE, time-to-3%, time-to-5%, and a false-positive/continuation outcome.

The previous validator mixed later highs/lows into a field labeled `mfe_3h`/`mae_3h`. V2 uses explicit time windows so the 3-hour outcome cannot contain later movement.

Views:
- `gn_precursor_pattern_validation_summary`
- `gn_precursor_ma_validation_summary`

Post-validation feedback is fail-neutral for small samples: it does not promote a pattern simply because one or two examples worked. Once an archetype has enough completed episodes, historical hit rate, false-positive rate and MFE/MAE asymmetry can add or subtract only a bounded score.

## Safety / anti-overfit rules
- Stablecoin-like KRW markets are excluded from candidate ranking.
- Extreme volume without buying support is not treated as ignition.
- TOP3 repetition with falling price is not rewarded.
- MA full alignment after the price is already stretched above MA20 is treated as late, not as an early signal.
- MA-transition is an additional archetype, not a hard requirement, so STORJ/ZORA-style patterns are not discarded.
- Post-validation requires a minimum sample before changing live weights.
