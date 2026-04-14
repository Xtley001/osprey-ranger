/**
 * 03-add-kamino-adaptor.ts
 *
 * Registers the Kamino adaptor program with the vault.
 * Must be done before initialising the Kamino strategy.
 *
 * KAMINO_ADAPTOR_PROGRAM_ID must be fetched from:
 *   https://docs.ranger.finance/security/deployed-programs
 * Do NOT use AI-generated addresses.
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
  const adminKp    = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(process.env.ADMIN_KEYPAIR!))
  );
  const vault = new PublicKey(process.env.VAULT_ADDRESS!);

  if (!process.env.KAMINO_ADAPTOR_PROGRAM_ID) {
    throw new Error(
      "KAMINO_ADAPTOR_PROGRAM_ID not set. " +
      "Get it from https://docs.ranger.finance/security/deployed-programs"
    );
  }

  const kaminoAdaptorId = new PublicKey(process.env.KAMINO_ADAPTOR_PROGRAM_ID);
  const client          = new VoltrClient(connection);

  console.log("Adding Kamino adaptor...");
  console.log("  Program ID:", kaminoAdaptorId.toBase58());

  const ix = await client.createAddAdaptorIx({
    vault,
    payer:         adminKp.publicKey,
    admin:         adminKp.publicKey,
    adaptorProgram: kaminoAdaptorId,
  });

  const tx  = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [adminKp]);

  console.log("✅ Kamino adaptor added. Sig:", sig);
}

main().catch((e) => { console.error(e); process.exit(1); });
