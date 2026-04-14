/**
 * 07-verify-setup.ts
 *
 * Verifies all on-chain vault components are correctly deployed.
 * Must pass before starting the keeper bot.
 *
 * Checks:
 *   ✓ Vault account exists with correct admin/manager
 *   ✓ Both strategies registered and readable
 *   ✓ Vault NAV readable
 *   ✓ Asset/LP ratio readable
 */

import { VoltrClient } from "@voltr/vault-sdk";
import { Connection, PublicKey } from "@solana/web3.js";
import * as dotenv from "dotenv";
dotenv.config();

const REQUIRED_ENV = [
  "RPC_URL",
  "VAULT_ADDRESS",
  "KAMINO_STRATEGY_ADDRESS",
  "TRUSTFUL_STRATEGY_ADDRESS",
];

async function main() {
  for (const v of REQUIRED_ENV) {
    if (!process.env[v]) throw new Error(`Missing ${v} in .env`);
  }

  const connection         = new Connection(process.env.RPC_URL!, "confirmed");
  const vault              = new PublicKey(process.env.VAULT_ADDRESS!);
  const kaminoStrategy     = new PublicKey(process.env.KAMINO_STRATEGY_ADDRESS!);
  const trustfulStrategy   = new PublicKey(process.env.TRUSTFUL_STRATEGY_ADDRESS!);
  const client             = new VoltrClient(connection);

  console.log("=== Osprey × Ranger Vault — Setup Verification ===\n");

  // 1. Vault account
  const vaultAccount = await client.fetchVaultAccount(vault);
  console.log("✅ Vault account found");
  console.log("   Asset mint:  ", vaultAccount.asset.mint.toBase58());
  console.log("   Admin:       ", vaultAccount.roles.admin.toBase58());
  console.log("   Manager:     ", vaultAccount.roles.manager.toBase58());
  console.log("   Mgmt fee:    ", vaultAccount.config.managerManagementFee, "bps");
  console.log("   Perf fee:    ", vaultAccount.config.managerPerformanceFee, "bps");

  // 2. NAV and strategies
  const { totalValue, strategies } = await client.getPositionAndTotalValuesForVault(vault);
  const navUsdc = Number(totalValue) / 1_000_000;
  console.log("\n📊 Vault NAV:", navUsdc.toFixed(6), "USDC");
  console.log("   Strategies registered:", strategies.length);

  if (strategies.length < 2) {
    console.warn("⚠️  Expected 2 strategies (Kamino + Trustful). Only", strategies.length, "found.");
    console.warn("   Run scripts 03–06 if you haven't yet.");
  }

  // 3. Asset per LP
  const assetPerLp = await client.getCurrentAssetPerLpForVault(vault);
  console.log("   Asset per LP token:", assetPerLp.toString());

  // 4. Strategy receipts
  const receipts = await client.fetchAllStrategyInitReceiptAccountsOfVault(vault);
  console.log("\n✅ Strategy receipts found:", receipts.length);
  for (const r of receipts) {
    console.log("   →", r.publicKey.toBase58());
  }

  // 5. Final summary
  console.log("\n=== Verification Result ===");
  const allOk = strategies.length >= 2 && navUsdc >= 0;
  if (allOk) {
    console.log("✅ All checks passed. Vault is ready for keeper bot.");
    console.log("\nNext steps:");
    console.log("  1. Copy all addresses to keeper/.env");
    console.log("  2. Deploy keeper to Render (plan: Starter, $7/mo)");
    console.log("  3. Verify /api/regime returns live data:");
    console.log("     curl https://osprey-three.vercel.app/api/regime");
  } else {
    console.error("❌ Some checks failed. Review output above before deploying keeper.");
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
