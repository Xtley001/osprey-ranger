/**
 * risk/limits.ts
 *
 * All hard risk constants in one place.
 * Change numbers here — nowhere else.
 *
 * NOTE on funding thresholds:
 *   HL pays funding every 8 hours (3× per day).
 *   Annualised = 8-hour rate × 3 × 365.
 *   All ANNUALISED constants below are in decimal form (0.08 = 8%).
 */

export const RISK_LIMITS = {
  // Maximum drawdown from high water mark before emergency exit
  MAX_DRAWDOWN_PCT: 0.05,         // 5%

  // Minimum annualised funding to hold HL position (8-hour rate × 3 × 365)
  MIN_FUNDING_ANNUALISED: 0.08,   // 8% annualised

  // Exit HL immediately if funding goes negative
  NEGATIVE_FUNDING_EXIT: true,

  // Rebalance only if drift from target exceeds this threshold
  REBALANCE_THRESHOLD_PCT: 0.05,  // 5%

  // Hard allocation caps
  MAX_HL_ALLOCATION_PCT:    0.80, // 80%
  MIN_KAMINO_ALLOCATION_PCT: 0.10, // 10%

  // HL account health — equity/marginUsed below this triggers a warning
  MIN_ACCOUNT_HEALTH: 1.5,        // 150% margin ratio

  // Max leverage on HL (1× = fully collateralised)
  MAX_POSITION_LEVERAGE: 1.0,

  // Minimum delta (USDC) required before executing a rebalance
  MIN_REBALANCE_USDC: 100,        // $100

  // Proximity to liquidation price that triggers emergency reduction
  LIQ_PROXIMITY_THRESHOLD: 0.10, // within 10% of liq price
} as const;

// Single source of truth for regime allocation targets.
// Imported by both keeper (allocator.ts) and shared/types.ts.
export const REGIME_ALLOCATION: Record<"HOT" | "NEUTRAL" | "COLD", { hl: number; kamino: number }> = {
  HOT:     { hl: 0.70, kamino: 0.30 },
  NEUTRAL: { hl: 0.40, kamino: 0.60 },
  COLD:    { hl: 0.05, kamino: 0.95 },
};
