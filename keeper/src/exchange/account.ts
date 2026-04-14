/**
 * exchange/account.ts
 *
 * Account-level queries against Hyperliquid.
 * Wraps hyperliquid.ts getters with logging and derived calculations.
 */

import {
  getAccountState,
  getPositions,
  getHlUsdcBalance,
  HlPosition,
} from "./hyperliquid";
import { config } from "../config";
import { log } from "../reporting/logger";

export interface HlAccountSummary {
  usdcBalance:    number;
  unrealisedPnl:  number;
  totalEquity:    number;  // usdcBalance + unrealisedPnl
  positions:      HlPosition[];
  marginUsed:     number;
  accountHealth:  number;  // totalEquity / marginUsed (>1 = solvent)
}

/**
 * Fetch a full account summary including all open positions and derived equity.
 */
export async function getAccountSummary(): Promise<HlAccountSummary> {
  const address = config.hlWalletAddress;

  const [state, positions] = await Promise.all([
    getAccountState(address),
    getPositions(address),
  ]);

  const usdcBalance   = parseFloat(state.marginSummary.accountValue);
  const marginUsed    = parseFloat(state.marginSummary.totalMarginUsed);
  const unrealisedPnl = positions.reduce(
    (sum, p) => sum + parseFloat(p.unrealizedPnl),
    0,
  );
  const totalEquity   = usdcBalance + unrealisedPnl;
  const accountHealth = marginUsed > 0 ? totalEquity / marginUsed : Infinity;

  return {
    usdcBalance,
    unrealisedPnl,
    totalEquity,
    positions,
    marginUsed,
    accountHealth,
  };
}

/**
 * Return the total USDC value held in HL (balance + unrealised PnL).
 * This is the number written to Trustful for mark-to-market.
 */
export async function getTotalHlValue(): Promise<number> {
  const summary = await getAccountSummary();
  log("info", "account.value", `HL equity: ${summary.totalEquity.toFixed(2)} USDC (unrealised PnL: ${summary.unrealisedPnl.toFixed(2)})`);
  return summary.totalEquity;
}
