/**
 * strategy/allocator.ts
 *
 * Computes target vault allocation from regime signal.
 * Confidence-weighted: low confidence blends toward COLD allocation.
 */

import type { RegimeLabel } from "../signal/client";
import { REGIME_ALLOCATION, RISK_LIMITS } from "../risk/limits";

export interface TargetAllocation {
  hlPct:     number;  // fraction of vault in Hyperliquid (Trustful)
  kaminoPct: number;  // fraction of vault in Kamino
}

/**
 * Compute target allocation given regime, confidence, and current funding rate.
 *
 * @param regime       - HOT | NEUTRAL | COLD
 * @param confidence   - 0–1 from Osprey signal API
 * @param fundingRate  - current annualised rate for top pair
 */
export function computeTargetAllocation(
  regime:      RegimeLabel,
  confidence:  number,
  fundingRate: number,
): TargetAllocation {
  // Negative funding → exit HL entirely, 100% Kamino
  if (fundingRate < 0 && RISK_LIMITS.NEGATIVE_FUNDING_EXIT) {
    return { hlPct: 0, kaminoPct: 1.0 };
  }

  // Below minimum threshold in non-HOT regime → use COLD allocation
  let base = REGIME_ALLOCATION[regime];
  if (fundingRate < RISK_LIMITS.MIN_FUNDING_ANNUALISED && regime !== "HOT") {
    base = REGIME_ALLOCATION["COLD"];
  }

  // Blend toward COLD allocation proportionally to (1 - confidence)
  const coldAlloc  = REGIME_ALLOCATION["COLD"];
  const blendedHl  = base.hl * confidence + coldAlloc.hl * (1 - confidence);

  // Enforce hard limits
  const clampedHl = Math.min(
    Math.max(blendedHl, 0),
    RISK_LIMITS.MAX_HL_ALLOCATION_PCT,
  );
  const clampedKamino = Math.max(1 - clampedHl, RISK_LIMITS.MIN_KAMINO_ALLOCATION_PCT);

  return {
    hlPct:     parseFloat(clampedHl.toFixed(4)),
    kaminoPct: parseFloat(clampedKamino.toFixed(4)),
  };
}

/**
 * Returns true if current allocation has drifted beyond the rebalance threshold.
 */
export function needsRebalance(currentHlPct: number, targetHlPct: number): boolean {
  return Math.abs(currentHlPct - targetHlPct) > RISK_LIMITS.REBALANCE_THRESHOLD_PCT;
}
