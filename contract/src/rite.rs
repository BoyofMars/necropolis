//! The Rite: deterministic resurrection rule.
//!
//! Coroners only *report* vital signs. Whether a plot stirs, falls back
//! ("false dawn") or rises is decided here, from terms that were frozen when
//! the plot opened. Mirrored in `web/src/core/resurrection.ts`.

use crate::types::{Observation, PlotState, Terms};
use near_sdk::json_types::U64;

pub fn required_volume(terms: &Terms, peak_daily_volume_usd: u64) -> u64 {
    let share = (peak_daily_volume_usd as u128 * terms.min_peak_volume_share_bps as u128 / 10_000) as u64;
    terms.min_volume_24h_usd.0.max(share)
}

pub fn required_mcap(terms: &Terms, baseline_mcap_usd: u64) -> u64 {
    let multiple = (baseline_mcap_usd as u128 * terms.min_mcap_multiple_x100 as u128 / 100) as u64;
    terms.min_mcap_usd.0.max(multiple)
}

/// Every criterion must hold for an observation to count as a sign of life.
pub fn passes(terms: &Terms, baseline_mcap: u64, peak_volume: u64, o: &Observation) -> bool {
    let liq = o.liquidity_usd.0;
    let vol = o.volume_24h_usd.0;
    if liq < terms.min_liquidity_usd.0 {
        return false;
    }
    if vol < required_volume(terms, peak_volume) {
        return false;
    }
    if o.traders_24h < terms.min_traders_24h {
        return false;
    }
    if o.market_cap_usd.0 < required_mcap(terms, baseline_mcap) {
        return false;
    }
    // volume / liquidity <= max (anti wash-trading)
    if (vol as u128) * 100 > (liq as u128) * terms.max_volume_to_liquidity_x100 as u128 {
        return false;
    }
    if o.flagged_share_bps > terms.max_flagged_share_bps {
        return false;
    }
    if o.sources < terms.min_sources {
        return false;
    }
    true
}

#[derive(Debug, PartialEq, Eq)]
pub enum Transition {
    Unchanged,
    BeganStirring,
    FalseDawn,
    StillStirring,
    Risen,
}

/// Advance the plot by one observation. `event_id` is the id to assign if it rises.
pub fn advance(
    terms: &Terms,
    baseline_mcap: u64,
    peak_volume: u64,
    state: &PlotState,
    o: &Observation,
    now: u64,
    event_id: u32,
) -> Result<(PlotState, Transition), &'static str> {
    let t = o.t.0;
    // Coroners may not report the future (60s clock skew allowed).
    if t > now + 60 {
        return Err("observation is in the future");
    }
    match state {
        PlotState::Risen { .. } => Err("plot has already risen"),
        PlotState::Resting { false_dawns, last_observed_at } => {
            if let Some(last) = last_observed_at {
                if t <= last.0 {
                    return Err("observations must move forward in time");
                }
            }
            if passes(terms, baseline_mcap, peak_volume, o) {
                Ok((
                    PlotState::Stirring { since: U64(t), last_at: U64(t), count: 1, false_dawns: *false_dawns },
                    Transition::BeganStirring,
                ))
            } else {
                Ok((
                    PlotState::Resting { false_dawns: *false_dawns, last_observed_at: Some(U64(t)) },
                    Transition::Unchanged,
                ))
            }
        }
        PlotState::Stirring { since, last_at, count, false_dawns } => {
            if t <= last_at.0 {
                return Err("observations must move forward in time");
            }
            let gap_ok = t - last_at.0 <= terms.max_gap_secs.0;
            if !gap_ok || !passes(terms, baseline_mcap, peak_volume, o) {
                return Ok((
                    PlotState::Resting { false_dawns: false_dawns + 1, last_observed_at: Some(U64(t)) },
                    Transition::FalseDawn,
                ));
            }
            let count = count + 1;
            if t - since.0 >= terms.window_secs.0 && count >= terms.min_observations {
                Ok((PlotState::Risen { at: U64(t), false_dawns: *false_dawns, event_id }, Transition::Risen))
            } else {
                Ok((
                    PlotState::Stirring { since: *since, last_at: U64(t), count, false_dawns: *false_dawns },
                    Transition::StillStirring,
                ))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::json_types::U128;

    fn obs(t: u64, liq: u64, vol: u64, mcap: u64, traders: u32) -> Observation {
        Observation {
            t: U64(t),
            price_usd_e18: U128(1),
            market_cap_usd: U64(mcap),
            liquidity_usd: U64(liq),
            volume_24h_usd: U64(vol),
            traders_24h: traders,
            flagged_share_bps: 500,
            sources: 2,
        }
    }

    fn alive(t: u64) -> Observation {
        obs(t, 120_000, 400_000, 2_000_000, 450)
    }

    const BASE_MCAP: u64 = 40_000;
    const PEAK: u64 = 900_000;

    #[test]
    fn thresholds_scale_with_baseline() {
        let terms = Terms::mainnet();
        assert_eq!(required_volume(&terms, PEAK), 90_000);
        assert_eq!(required_volume(&terms, 10_000), 25_000);
        assert_eq!(required_mcap(&terms, BASE_MCAP), 250_000);
        assert_eq!(required_mcap(&terms, 1_000_000), 5_000_000);
    }

    #[test]
    fn full_rite_rises_after_window() {
        let terms = Terms::testnet();
        let mut s = PlotState::Resting { false_dawns: 0, last_observed_at: None };
        let t0 = 1_000_000;
        let (n, tr) = advance(&terms, BASE_MCAP, PEAK, &s, &alive(t0), t0, 0).unwrap();
        assert_eq!(tr, Transition::BeganStirring);
        s = n;
        let (n, tr) = advance(&terms, BASE_MCAP, PEAK, &s, &alive(t0 + 150), t0 + 150, 0).unwrap();
        assert_eq!(tr, Transition::StillStirring);
        s = n;
        let (n, tr) = advance(&terms, BASE_MCAP, PEAK, &s, &alive(t0 + 300), t0 + 300, 0).unwrap();
        assert_eq!(tr, Transition::StillStirring); // 300s < 360s window
        s = n;
        let (n, tr) = advance(&terms, BASE_MCAP, PEAK, &s, &alive(t0 + 400), t0 + 400, 7).unwrap();
        assert_eq!(tr, Transition::Risen);
        assert_eq!(n, PlotState::Risen { at: U64(t0 + 400), false_dawns: 0, event_id: 7 });
    }

    #[test]
    fn wash_trading_does_not_count() {
        let terms = Terms::mainnet();
        // 25x volume / liquidity
        let o = obs(10, 60_000, 1_500_000, 2_000_000, 400);
        assert!(!passes(&terms, BASE_MCAP, PEAK, &o));
        let mut flagged = alive(10);
        flagged.flagged_share_bps = 3_100;
        assert!(!passes(&terms, BASE_MCAP, PEAK, &flagged));
        let mut single = alive(10);
        single.sources = 1;
        assert!(!passes(&terms, BASE_MCAP, PEAK, &single));
    }

    #[test]
    fn a_pump_from_zero_is_not_a_resurrection() {
        let terms = Terms::mainnet();
        // 100x from a tiny base but only $8k liquidity and 30 traders
        let o = obs(10, 8_000, 30_000, 400_000, 30);
        assert!(!passes(&terms, BASE_MCAP, PEAK, &o));
    }

    #[test]
    fn failed_observation_is_a_false_dawn() {
        let terms = Terms::testnet();
        let s = PlotState::Stirring { since: U64(100), last_at: U64(100), count: 1, false_dawns: 2 };
        let (n, tr) = advance(&terms, BASE_MCAP, PEAK, &s, &obs(200, 1_000, 10, 10, 1), 200, 0).unwrap();
        assert_eq!(tr, Transition::FalseDawn);
        assert_eq!(n, PlotState::Resting { false_dawns: 3, last_observed_at: Some(U64(200)) });
    }

    #[test]
    fn gaps_break_the_streak() {
        let terms = Terms::testnet();
        let s = PlotState::Stirring { since: U64(100), last_at: U64(100), count: 2, false_dawns: 0 };
        let (_, tr) = advance(&terms, BASE_MCAP, PEAK, &s, &alive(100 + 181), 1_000, 0).unwrap();
        assert_eq!(tr, Transition::FalseDawn);
    }

    #[test]
    fn rejects_time_travel() {
        let terms = Terms::testnet();
        let s = PlotState::Resting { false_dawns: 0, last_observed_at: Some(U64(500)) };
        assert!(advance(&terms, BASE_MCAP, PEAK, &s, &alive(400), 1_000, 0).is_err());
        assert!(advance(&terms, BASE_MCAP, PEAK, &s, &alive(5_000), 1_000, 0).is_err());
        let r = PlotState::Risen { at: U64(1), false_dawns: 0, event_id: 0 };
        assert!(advance(&terms, BASE_MCAP, PEAK, &r, &alive(600), 1_000, 0).is_err());
    }

    #[test]
    fn needs_minimum_observations_even_after_window() {
        let terms = Terms::testnet();
        let s = PlotState::Stirring { since: U64(0), last_at: U64(170), count: 1, false_dawns: 0 };
        // window elapsed (>=360s) would need a gap > 180 → false dawn; so build count up legitimately
        let (n, _) = advance(&terms, BASE_MCAP, PEAK, &s, &alive(340), 1_000, 0).unwrap();
        // count is now 2 < 3 and window not yet elapsed
        assert!(matches!(n, PlotState::Stirring { count: 2, .. }));
        let (n, tr) = advance(&terms, BASE_MCAP, PEAK, &n, &alive(500), 1_000, 1).unwrap();
        assert_eq!(tr, Transition::Risen);
        assert!(matches!(n, PlotState::Risen { .. }));
    }
}
