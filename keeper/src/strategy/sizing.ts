/**
 * strategy/sizing.ts
 *
 * Position sizing for HL short perp.
 * Always 1× leverage (fully collateralised). No amplification.
 */

import { RISK_LIMITS } from "../risk/limits";

/**
 * Compute the contract size for a short perp given USDC notional and mark price.
 *
 * HL notional = hlAllocationUsdc
 * contracts   = notional / markPrice
 *
 * Leverage is always 1×: USDC margin equals the full notional.
 * Higher leverage doesn't increase funding income (paid on notional)
 * but does increase liquidation risk — keep at 1×.
 */
export function computePositionSize(
  hlAllocationUsdc: number,
  markPrice:        number,
): { sizeContracts: number; notionalUsdc: number } {
  if (markPrice <= 0) throw new Error("markPrice must be positive");

  const notionalUsdc  = hlAllocationUsdc * RISK_LIMITS.MAX_POSITION_LEVERAGE;
  const sizeContracts = notionalUsdc / markPrice;

  return {
    sizeContracts: parseFloat(sizeContracts.toFixed(8)),
    notionalUsdc:  parseFloat(notionalUsdc.toFixed(2)),
  };
}

/**
 * Compute the USDC size of a position delta — how much needs to be
 * added or removed from HL given current and target allocation.
 */
export function computeRebalanceDelta(
  totalNavUsdc:  number,
  targetHlPct:   number,
  currentHlUsdc: number,
): number {
  const targetHlUsdc = totalNavUsdc * targetHlPct;
  return targetHlUsdc - currentHlUsdc; // positive = need more in HL; negative = reduce HL
}
