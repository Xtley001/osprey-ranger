/**
 * 05-init-kamino-strategy.ts
 *
 * Initialises a Kamino lending strategy within the vault.
 * Deploys a new strategy account that the keeper will deposit into.
 *
 * Required env vars (all from primary sources — do not use AI-generated addresses):
 *   KAMINO_ADAPTOR_PROGRAM_ID  → docs.ranger.finance/security/deployed-programs
 *   KAMINO_LENDING_MARKET      → app.kamino.finance (USDC Main Market)
 *   KAMINO_RESERVE             → voltrxyz/kamino-scripts repo README
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

  for (const v of ["KAMINO_ADAPTOR_PROGRAM_ID", "KAMINO_LENDING_MARKET", "KAMINO_RESERVE"]) {
    if (!process.env[v]) throw new Error(`${v} not set — verify from primary sources`);
  }

  const KAMINO_ADAPTOR_PROGRAM_ID = new PublicKey(process.env.KAMINO_ADAPTOR_PROGRAM_ID!);
  const KAMINO_LENDING_MARKET     = new PublicKey(process.env.KAMINO_LENDING_MARKET!);
  const KAMINO_RESERVE            = new PublicKey(process.env.KAMINO_RESERVE!);

  const strategyKp = Keypair.generate(); // new keypair for this strategy account
  const client     = new VoltrClient(connection);

  console.log("Initialising Kamino USDC lending strategy...");
  console.log("  Strategy address:", strategyKp.publicKey.toBase58());

  const ix = await client.createInitializeStrategyIx(
    { instructionDiscriminator: null, additionalArgs: null },
    {
      payer:         adminKp.publicKey,
      vault,
      manager:       managerKp.publicKey,
      strategy:      strategyKp.publicKey,
      adaptorProgram: KAMINO_ADAPTOR_PROGRAM_ID,
      remainingAccounts: [
        { pubkey: KAMINO_LENDING_MARKET, isSigner: false, isWritable: false },
        { pubkey: KAMINO_RESERVE,        isSigner: false, isWritable: true  },
      ],
    },
  );

  const tx  = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(
    connection, tx, [adminKp, managerKp, strategyKp]
  );

  console.log("✅ Kamino strategy initialized");
  console.log("   Strategy address:", strategyKp.publicKey.toBase58());
  console.log("   Sig:", sig);
  console.log("\n→ Add to .env:  KAMINO_STRATEGY_ADDRESS=" + strategyKp.publicKey.toBase58());
}

main().catch((e) => { console.error(e); process.exit(1); });
