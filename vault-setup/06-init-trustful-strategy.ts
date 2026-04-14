/**
 * 06-init-trustful-strategy.ts
 *
 * Initialises a Trustful strategy within the vault.
 * Trustful maps an off-chain account balance (your HL wallet) into vault NAV.
 *
 * Required env vars:
 *   TRUSTFUL_ADAPTOR_PROGRAM_ID → docs.ranger.finance/security/deployed-programs
 *   HL_DEPOSIT_WALLET           → the Solana-side pubkey associated with your HL EVM wallet
 *
 * Consult https://github.com/voltrxyz/trustful-scripts for the exact
 * remainingAccounts layout before running.
 */

import { VoltrClient } from "@voltr/vault-sdk";
import {
  Connection, Keypair, PublicKey,
  sendAndConfirmTransaction, Transaction,
} from "@solana/web3.js";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const connection = new Connection(process.env.RPC_URL!, "confirmed");
  const managerKp  = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.MANAGER_KEYPAIR!)));
  const adminKp    = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.ADMIN_KEYPAIR!)));
  const vault      = new PublicKey(process.env.VAULT_ADDRESS!);

  for (const v of ["TRUSTFUL_ADAPTOR_PROGRAM_ID", "HL_DEPOSIT_WALLET"]) {
    if (!process.env[v]) throw new Error(`${v} not set — verify from primary sources`);
  }

  const TRUSTFUL_ADAPTOR_PROGRAM_ID = new PublicKey(process.env.TRUSTFUL_ADAPTOR_PROGRAM_ID!);
  const HL_DEPOSIT_WALLET           = new PublicKey(process.env.HL_DEPOSIT_WALLET!);

  const strategyKp = Keypair.generate();
  const client     = new VoltrClient(connection);

  console.log("Initialising Trustful HL bridge strategy...");
  console.log("  Strategy address:  ", strategyKp.publicKey.toBase58());
  console.log("  HL deposit wallet: ", HL_DEPOSIT_WALLET.toBase58());

  // ⚠️  Verify remainingAccounts layout from trustful-scripts BEFORE running:
  //     https://github.com/voltrxyz/trustful-scripts
  const ix = await client.createInitializeStrategyIx(
    { instructionDiscriminator: null, additionalArgs: null },
    {
      payer:          adminKp.publicKey,
      vault,
      manager:        managerKp.publicKey,
      strategy:       strategyKp.publicKey,
      adaptorProgram: TRUSTFUL_ADAPTOR_PROGRAM_ID,
      remainingAccounts: [
        { pubkey: HL_DEPOSIT_WALLET, isSigner: false, isWritable: false },
        // Add any additional accounts required by trustful-scripts here
      ],
    },
  );

  const tx  = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(
    connection, tx, [adminKp, managerKp, strategyKp]
  );

  console.log("✅ Trustful strategy initialized");
  console.log("   Strategy address:", strategyKp.publicKey.toBase58());
  console.log("   Sig:", sig);
  console.log("\n→ Add to .env:  TRUSTFUL_STRATEGY_ADDRESS=" + strategyKp.publicKey.toBase58());
}

main().catch((e) => { console.error(e); process.exit(1); });
