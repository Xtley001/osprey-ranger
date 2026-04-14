/**
 * reporting/nav.ts
 *
 * Compute total vault NAV from on-chain vault state.
 */

import { Connection } from "@solana/web3.js";
import { VoltrClient } from "@voltr/vault-sdk";
import { getVaultPubkey, getVaultTotalValue } from "../vault/client";
import { getTotalHlValue } from "../exchange/account";
import { getHlUsdcBalance } from "../exchange/hyperliquid";
import { log, logNav } from "./logger";
import { config } from "../config";

export interface NavSnapshot {
  totalNav:      number;
  hlValue:       number;
  kaminoValue:   number;
  assetPerLp:    number;
  unrealisedPnl: number;
  hlPct:         number;
  kaminoPct:     number;
}

export async function computeNavSnapshot(
  client:     VoltrClient,
  _connection: Connection,
): Promise<NavSnapshot> {
  const [totalNav, hlValue, assetPerLpRaw] = await Promise.all([
    getVaultTotalValue(client),
    getTotalHlValue(),
    client.getCurrentAssetPerLpForVault(getVaultPubkey()),
  ]);

  const hlBalance    = await getHlUsdcBalance(config.hlWalletAddress);
  const unrealisedPnl = hlValue - hlBalance;
  const kaminoValue  = Math.max(totalNav - hlValue, 0);
  const assetPerLp   = parseFloat(String(assetPerLpRaw));
  const hlPct        = totalNav > 0 ? hlValue / totalNav : 0;
  const kaminoPct    = totalNav > 0 ? kaminoValue / totalNav : 0;

  const snap: NavSnapshot = {
    totalNav,
    hlValue,
    kaminoValue,
    assetPerLp,
    unrealisedPnl,
    hlPct:    parseFloat(hlPct.toFixed(4)),
    kaminoPct: parseFloat(kaminoPct.toFixed(4)),
  };

  log("info", "nav.snapshot", JSON.stringify({
    totalNav:   totalNav.toFixed(2),
    hlValue:    hlValue.toFixed(2),
    kamino:     kaminoValue.toFixed(2),
    assetPerLp: assetPerLp.toFixed(8),
    hlPct:      (hlPct * 100).toFixed(1) + "%",
  }));

  await logNav(totalNav, hlValue, kaminoValue, assetPerLp, unrealisedPnl);

  return snap;
}
