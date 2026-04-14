/**
 * strategy/rebalancer.ts
 *
 * Main rebalance loop — runs every 15 minutes.
 * Reads regime from Osprey, computes target allocation,
 * then moves capital between Kamino and Hyperliquid.
 *
 * Capital flow:
 *   HOT/NEUTRAL  → withdraw from Kamino → bridge to HL → open short perp
 *   COLD/exit    → close short perp → bridge back → deposit to Kamino
 *
 * NOTE: Cross-chain USDC bridging (Solana ↔ Hyperliquid) is not automated
 * in v1. The bot computes the delta and logs the bridge instruction.
 * After bridging manually, call executeHlLeg() manually or wait for the next
 * rebalance tick which will pick it up automatically.
 * v2 will integrate Circle CCTP for automated bridging.
 */

import { Connection } from "@solana/web3.js";
import { VoltrClient } from "@voltr/vault-sdk";
import { fetchRegime } from "../signal/client";
import { computeTargetAllocation, needsRebalance } from "./allocator";
import { computeRebalanceDelta, computePositionSize } from "./sizing";
import { getVaultTotalValue } from "../vault/client";
import { depositKamino, withdrawKamino } from "../vault/kamino";
import {
  getHlUsdcBalance,
  getFundingRate,
  getMarkPrice,
  getPositions,
} from "../exchange/hyperliquid";
import { openShortPerp, closeShortPerp } from "../exchange/orders";
import { log, logRebalance } from "../reporting/logger";
import { RISK_LIMITS } from "../risk/limits";
import { config } from "../config";

// HL pays funding every 8 hours — 3 periods per day
const FUNDING_PERIODS_PER_DAY = 3;
const FUNDING_ANNUALISE = FUNDING_PERIODS_PER_DAY * 365;

export async function rebalanceLoop(
  client:     VoltrClient,
  connection: Connection,
): Promise<void> {
  log("info", "rebalancer.tick", "Rebalance loop tick");

  // 1. Fetch current state
  const regimeSignal = await fetchRegime();
  const totalNav     = await getVaultTotalValue(client);
  const hlBalance    = await getHlUsdcBalance(config.hlWalletAddress);
  const fundingRate  = await getFundingRate(regimeSignal.topPair);  // 8-hour rate
  const fundingAnn   = fundingRate * FUNDING_ANNUALISE;              // annualised

  const currentHlPct = totalNav > 0 ? hlBalance / totalNav : 0;

  // 2. Compute target allocation
  const target = computeTargetAllocation(
    regimeSignal.regime,
    regimeSignal.confidence,
    fundingAnn,
  );

  log("info", "rebalancer.state", JSON.stringify({
    regime:       regimeSignal.regime,
    confidence:   regimeSignal.confidence.toFixed(2),
    totalNav:     totalNav.toFixed(2),
    hlBalance:    hlBalance.toFixed(2),
    currentHlPct: currentHlPct.toFixed(3),
    targetHlPct:  target.hlPct.toFixed(3),
    fundingAnn:   (fundingAnn * 100).toFixed(2) + "%",
  }));

  // 3. Check if rebalance is needed
  if (!needsRebalance(currentHlPct, target.hlPct)) {
    log("info", "rebalancer.skip", "Within threshold — no rebalance needed");
    return;
  }

  const delta = computeRebalanceDelta(totalNav, target.hlPct, hlBalance);

  if (Math.abs(delta) < RISK_LIMITS.MIN_REBALANCE_USDC) {
    log("info", "rebalancer.skip", `Delta ${delta.toFixed(2)} USDC below minimum — skipping`);
    return;
  }

  log("info", "rebalancer.execute", `Rebalancing. Delta: ${delta.toFixed(2)} USDC`);

  if (delta > 0) {
    // Need MORE in HL → withdraw from Kamino, bridge to HL, open short
    await withdrawKamino(client, connection, delta);

    log("warn", "rebalancer.bridge",
      `v1: Manual bridge required — transfer ${delta.toFixed(2)} USDC ` +
      `from Solana wallet to HL wallet (${config.hlWalletAddress}). ` +
      `Visit: app.hyperliquid.xyz/deposit. Then the next rebalance tick ` +
      `will open the short position automatically once funds arrive.`
    );

    // Open the short perp hedge
    // In v1, this fires after the bridge but funds may not have arrived yet.
    // If the order fails due to insufficient margin it is logged and retried
    // on the next tick once the balance has updated on HL.
    await openHlShort(regimeSignal.topPair, delta);

  } else {
    // Need LESS in HL → close partial short, bridge back, deposit to Kamino
    const reduceAmt = Math.abs(delta);

    await closeHlShort(regimeSignal.topPair, reduceAmt);

    log("warn", "rebalancer.bridge",
      `v1: Manual bridge required — withdraw ${reduceAmt.toFixed(2)} USDC ` +
      `from HL wallet and transfer to Solana. ` +
      `Visit: app.hyperliquid.xyz/withdraw`
    );

    await depositKamino(client, connection, reduceAmt);
  }

  await logRebalance({
    timestamp:     new Date(),
    regime:        regimeSignal.regime,
    totalNav,
    hlBalance,
    kaminoBalance: totalNav - hlBalance,
    targetHlPct:   target.hlPct,
    actualHlPct:   currentHlPct,
    delta,
    fundingRate,
    executed: true,
  });
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Open or top up the short perp position on HL.
 * Skips if HL balance is insufficient (funds may still be bridging).
 */
async function openHlShort(coin: string, usdcAmount: number): Promise<void> {
  try {
    const markPx = await getMarkPrice(coin);
    const { sizeContracts } = computePositionSize(usdcAmount, markPx);

    log("info", "rebalancer.open", `Opening short ${coin} sz=${sizeContracts} at ~${markPx}`);
    const result = await openShortPerp(coin, sizeContracts, markPx);

    if (!result.success) {
      log("warn", "rebalancer.open",
        `Short order failed (funds may still be bridging): ${result.error}. ` +
        `Will retry on next rebalance tick.`
      );
    } else {
      log("info", "rebalancer.open", `Short opened. Order: ${result.orderId}`);
    }
  } catch (e) {
    log("error", "rebalancer.open", `openHlShort error: ${String(e)}`);
  }
}

/**
 * Close or reduce the short perp position on HL.
 * Proportionally reduces the position by usdcAmount.
 */
async function closeHlShort(coin: string, usdcAmount: number): Promise<void> {
  try {
    const positions = await getPositions(config.hlWalletAddress);
    const pos = positions.find((p) => p.coin.toUpperCase() === coin.toUpperCase());

    if (!pos) {
      log("warn", "rebalancer.close", `No open ${coin} position to reduce`);
      return;
    }

    const markPx    = await getMarkPrice(coin);
    const totalSize = Math.abs(parseFloat(pos.szi));
    const { sizeContracts } = computePositionSize(usdcAmount, markPx);
    const reduceSize = Math.min(sizeContracts, totalSize); // never exceed position size

    log("info", "rebalancer.close", `Reducing short ${coin} by sz=${reduceSize}`);
    const result = await closeShortPerp(coin, reduceSize, markPx * 1.001); // 0.1% slippage

    if (!result.success) {
      log("error", "rebalancer.close", `Close order failed: ${result.error}`);
    } else {
      log("info", "rebalancer.close", `Short reduced. Order: ${result.orderId}`);
    }
  } catch (e) {
    log("error", "rebalancer.close", `closeHlShort error: ${String(e)}`);
  }
}
