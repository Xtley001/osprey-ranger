/**
 * risk/monitor.ts
 *
 * Risk monitor loop — runs every 5 minutes.
 * Checks: drawdown from HWM, funding flip, account health, liquidation proximity.
 * Triggers emergency exit on breach.
 *
 * High-water mark is loaded from the database on first run so it survives restarts.
 */

import { Connection } from "@solana/web3.js";
import { VoltrClient } from "@voltr/vault-sdk";
import { Pool } from "pg";
import { config } from "../config";
import { getVaultTotalValue } from "../vault/client";
import { getAccountSummary } from "../exchange/account";
import { getFundingRate, getMarkPrice } from "../exchange/hyperliquid";
import { RISK_LIMITS } from "./limits";
import { emergencyExit } from "./emergency";
import { fetchRegime } from "../signal/client";
import { log } from "../reporting/logger";

// HL pays funding every 8 hours — 3 periods per day
const FUNDING_ANNUALISE = 3 * 365;

// HWM persisted across restarts via nav_history table
let highWaterMark: number | null = null;

const pool = new Pool({ connectionString: config.databaseUrl });

async function loadHighWaterMark(): Promise<number> {
  try {
    const res = await pool.query<{ max_nav: string }>(
      "SELECT MAX(total_nav) as max_nav FROM nav_history"
    );
    return parseFloat(res.rows[0]?.max_nav ?? "0") || 0;
  } catch {
    log("warn", "risk.hwm", "Could not load HWM from DB — starting from 0");
    return 0;
  }
}

export async function riskMonitorLoop(
  client:     VoltrClient,
  connection: Connection,
): Promise<void> {
  // Load HWM from DB on first tick (survives process restarts)
  if (highWaterMark === null) {
    highWaterMark = await loadHighWaterMark();
    log("info", "risk.hwm", `Loaded HWM from DB: ${highWaterMark.toFixed(2)} USDC`);
  }

  const [totalNav, hlSummary] = await Promise.all([
    getVaultTotalValue(client),
    getAccountSummary(),
  ]);

  if (totalNav > highWaterMark) {
    highWaterMark = totalNav;
  }

  const drawdown = highWaterMark > 0
    ? (highWaterMark - totalNav) / highWaterMark
    : 0;

  log("info", "risk.monitor", JSON.stringify({
    totalNav:  totalNav.toFixed(2),
    hwm:       highWaterMark.toFixed(2),
    drawdown:  (drawdown * 100).toFixed(2) + "%",
    hlEquity:  hlSummary.totalEquity.toFixed(2),
    hlHealth:  hlSummary.accountHealth === Infinity
                 ? "∞" : hlSummary.accountHealth.toFixed(2),
  }));

  // ── Drawdown check ──────────────────────────────────────────────────────────
  if (drawdown > RISK_LIMITS.MAX_DRAWDOWN_PCT) {
    log("error", "risk.drawdown",
      `DRAWDOWN LIMIT HIT: ${(drawdown * 100).toFixed(2)}% > ${(RISK_LIMITS.MAX_DRAWDOWN_PCT * 100)}%. Emergency exit.`);
    await emergencyExit(client, connection, "drawdown_limit");
    return;
  }

  // ── Funding rate check ──────────────────────────────────────────────────────
  if (hlSummary.positions.length > 0) {
    const regime      = await fetchRegime();
    const fundingRate = await getFundingRate(regime.topPair); // 8-hour rate
    const fundingAnn  = fundingRate * FUNDING_ANNUALISE;       // annualised

    if (fundingRate < 0 && RISK_LIMITS.NEGATIVE_FUNDING_EXIT) {
      log("error", "risk.funding",
        `Negative funding rate: ${(fundingAnn * 100).toFixed(2)}%/yr. Triggering emergency exit.`);
      await emergencyExit(client, connection, "negative_funding");
      return;
    }

    if (fundingAnn < RISK_LIMITS.MIN_FUNDING_ANNUALISED && regime.regime !== "HOT") {
      log("warn", "risk.funding",
        `Funding below minimum (${(fundingAnn * 100).toFixed(2)}%/yr). Rebalancer will reduce HL on next tick.`);
    }
  }

  // ── Account health + liquidation proximity check ────────────────────────────
  for (const pos of hlSummary.positions) {
    if (pos.liquidationPx === null) continue;

    // Use live mark price, not entry price
    let markPx: number;
    try {
      markPx = await getMarkPrice(pos.coin);
    } catch {
      log("warn", "risk.health", `Could not fetch mark price for ${pos.coin} — skipping proximity check`);
      continue;
    }

    const liqPx = parseFloat(pos.liquidationPx);
    if (markPx <= 0 || liqPx <= 0) continue;

    // For a short: liq price is above mark price
    const proximity = Math.abs((liqPx - markPx) / markPx);

    if (proximity < RISK_LIMITS.LIQ_PROXIMITY_THRESHOLD) {
      log("error", "risk.health",
        `${pos.coin} is within ${(proximity * 100).toFixed(1)}% of liquidation (markPx=${markPx}, liqPx=${liqPx}). Emergency exit.`);
      await emergencyExit(client, connection, "near_liquidation");
      return;
    }
  }
}
