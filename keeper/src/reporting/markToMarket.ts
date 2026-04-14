/**
 * reporting/markToMarket.ts
 *
 * Mark-to-market loop — runs every hour.
 * Fetches actual HL account equity and writes it back to the vault
 * via the Trustful adaptor so LP token price stays accurate.
 */

import { Connection } from "@solana/web3.js";
import { VoltrClient } from "@voltr/vault-sdk";
import { getTotalHlValue } from "../exchange/account";
import { markTrustfulValue } from "../vault/trustful";
import { computeNavSnapshot } from "./nav";
import { log } from "./logger";

export async function markToMarketLoop(
  client:     VoltrClient,
  connection: Connection,
): Promise<void> {
  log("info", "mtm.tick", "Mark-to-market loop tick");

  // Fetch real HL account value (balance + unrealised PnL)
  const totalHlValue = await getTotalHlValue();

  // Write to vault via Trustful adaptor — updates LP token NAV
  const sig = await markTrustfulValue(client, connection, totalHlValue);
  log("info", "mtm.marked", `Trustful value marked at ${totalHlValue.toFixed(2)} USDC. Sig: ${sig}`);

  // Log a full NAV snapshot after marking
  const snap = await computeNavSnapshot(client, connection);
  log("info", "mtm.nav", `Updated vault NAV: ${snap.totalNav.toFixed(2)} USDC | Asset/LP: ${snap.assetPerLp.toFixed(8)}`);
}
