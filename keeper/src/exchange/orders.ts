/**
 * exchange/orders.ts
 *
 * Open and close perp positions on Hyperliquid.
 * Uses Alo (post-only maker, 0.010%) for entries,
 * Ioc (taker, 0.035%) for exits and fallbacks.
 */

import { placeOrder, getFundingRate, getCoinIndex } from "./hyperliquid";
import { log } from "../reporting/logger";

export interface OrderResult {
  success: boolean;
  orderId?: string;
  filledAsMaker?: boolean;
  error?: string;
}

/**
 * Open a short perp position (funding harvesting leg).
 * Tries Alo (post-only maker) first; falls back to Ioc if rejected.
 *
 * @param coin - e.g. "BTC", "NVDA"
 * @param sz   - size in contracts
 * @param px   - limit price
 */
export async function openShortPerp(
  coin: string,
  sz:   number,
  px:   number,
): Promise<OrderResult> {
  log("info", "orders.open", `Opening short ${coin} sz=${sz} px=${px}`);

  // Try post-only maker first — 0.010% fee vs 0.035% taker
  const makerResult = await placeOrder({
    coin,
    isBuy:     false,
    sz,
    px,
    tif:       "Alo",
    reduceOnly: false,
  });

  if (makerResult.success) {
    log("info", "orders.open", `Short opened as maker. Order: ${makerResult.orderId}`);
    return makerResult;
  }

  // Alo rejected (would cross book) — retry as taker
  if (makerResult.error?.includes("Would immediately cross")) {
    log("info", "orders.open", `Alo rejected — retrying as Ioc (taker)`);
    const takerResult = await placeOrder({
      coin,
      isBuy:     false,
      sz,
      px:        px * 0.9995, // slight slippage buffer for taker
      tif:       "Ioc",
      reduceOnly: false,
    });
    if (takerResult.success) {
      log("info", "orders.open", `Short opened as taker. Order: ${takerResult.orderId}`);
    } else {
      log("error", "orders.open", `Taker order also failed: ${takerResult.error}`);
    }
    return takerResult;
  }

  log("error", "orders.open", `Order failed: ${makerResult.error}`);
  return makerResult;
}

/**
 * Close an existing short position (buy to cover).
 * Always uses Ioc — exits require immediate fill.
 *
 * @param coin - pair to close
 * @param sz   - absolute size (positive), not signed
 * @param px   - worst-case limit price (we pay UP TO this to close)
 */
export async function closeShortPerp(
  coin: string,
  sz:   number,
  px:   number,
): Promise<OrderResult> {
  log("info", "orders.close", `Closing short ${coin} sz=${sz} px=${px}`);

  const result = await placeOrder({
    coin,
    isBuy:     true,   // buy to close short
    sz,
    px,
    tif:       "Ioc",  // immediate fill — exits always taker
    reduceOnly: true,
  });

  if (result.success) {
    log("info", "orders.close", `Short closed. Order: ${result.orderId}`);
  } else {
    log("error", "orders.close", `Close failed: ${result.error}`);
  }

  return result;
}
