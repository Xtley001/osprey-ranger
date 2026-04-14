import { VoltrClient } from "@voltr/vault-sdk";
import {
  Connection, Keypair, PublicKey,
  sendAndConfirmTransaction, Transaction,
} from "@solana/web3.js";
import { BN } from "bn.js";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const connection = new Connection(process.env.RPC_URL!, "confirmed");
  const adminKp = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(process.env.ADMIN_KEYPAIR!))
  );
  const managerKp = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(process.env.MANAGER_KEYPAIR!))
  );
  const vaultKp = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(process.env.VAULT_KEYPAIR!))
  );
  const usdcMint = new PublicKey(process.env.USDC_MINT!);
  const client = new VoltrClient(connection);

  console.log("Creating Osprey Delta-Neutral Yield vault...");
  console.log("  Admin:   ", adminKp.publicKey.toBase58());
  console.log("  Manager: ", managerKp.publicKey.toBase58());
  console.log("  Vault:   ", vaultKp.publicKey.toBase58());

  const ix = await client.createInitializeVaultIx(
    {
      config: {
        maxCap:                new BN(10_000_000_000_000),
        startAtTs:             new BN(Math.floor(Date.now() / 1000)),
        managerManagementFee:  100,
        managerPerformanceFee: 2000,
        adminManagementFee:    0,
        adminPerformanceFee:   0,
      },
      name:        "Osprey Delta-Neutral Yield",
      description: "HL funding + Kamino lending, regime-gated",
    },
    {
      vault:          vaultKp,
      vaultAssetMint: usdcMint,
      admin:          adminKp.publicKey,
      manager:        managerKp.publicKey,
      payer:          adminKp.publicKey,
    },
  );

  const tx  = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [adminKp, vaultKp]);

  console.log("\n✅ Vault created successfully");
  console.log("   Vault address:", vaultKp.publicKey.toBase58());
  console.log("   Signature:    ", sig);
  console.log("\n→ Add to .env:  VAULT_ADDRESS=" + vaultKp.publicKey.toBase58());
}

main().catch((e) => { console.error(e); process.exit(1); });
