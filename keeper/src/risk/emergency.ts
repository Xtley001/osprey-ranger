/**
 * risk/emergency.ts
 *
 * Full emergency exit procedure.
 * Triggered by: drawdown limit, negative funding, near-liquidation.
 * Closes all HL positions and marks final value to vault.
 */

import { Connection } from "@solana/web3.js";
import { VoltrClient } from "@voltr/vault-sdk";
import { getPositions, getHlUsdcBalance } from "../exchange/hyperliquid";
import { closeShortPerp } from "../exchange/orders";
import { markTrustfulValue } from "../vault/trustful";
import { log } from "../reporting/logger";
import { config } from "../config";

export type ExitReason =
  | "drawdown_limit"
  | "negative_funding"
  | "near_liquidation"
  | "manual";

export async function emergencyExit(
  client:     VoltrClient,
  connection: Connection,
  reason:     ExitReason,
): Promise<void> {
  log("error", "emergency.start", `Emergency exit triggered: ${reason}`);

  const positions = await getPositions(config.hlWalletAddress);

  if (positions.length === 0) {
    log("info", "emergency.nopos", "No open positions — nothing to close");
  }

  // Close all positions
  for (const pos of positions) {
    const sz = Math.abs(parseFloat(pos.szi));
    if (sz === 0) continue;

    const entryPx  = parseFloat(pos.entryPx);
    // For closing a short, we buy back — worst case pay 1% above entry
    const limitPx  = entryPx * 1.01;

    log("error", "emergency.close", `Closing ${pos.coin} sz=${sz.toFixed(6)} limit=${limitPx.toFixed(4)}`);

    const result = await closeShortPerp(pos.coin, sz, limitPx);

    if (!result.success) {
      log("error", "emergency.close",
        `Failed to close ${pos.coin}: ${result.error} — MANUAL ACTION REQUIRED`);
      // Continue trying other positions — do not throw
    } else {
      log("error", "emergency.closed", `${pos.coin} closed. Order: ${result.orderId}`);
    }
  }

  // Mark final HL value to vault after all positions are closed
  const finalHlValue = await getHlUsdcBalance(config.hlWalletAddress);
  await markTrustfulValue(client, connection, finalHlValue);

  log("error", "emergency.done",
    `Emergency exit complete. Reason: ${reason}. Final HL equity: ${finalHlValue.toFixed(2)} USDC. ` +
    `USDC now in HL account — manual withdrawal to Solana required (v1). ` +
    `Bridge via Hyperliquid → Solana: app.hyperliquid.xyz/withdraw`
  );
}
