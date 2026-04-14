/**
 * 04-add-trustful-adaptor.ts
 *
 * Registers the Trustful adaptor program with the vault.
 * Trustful is used for recording off-chain HL account value in vault NAV.
 *
 * TRUSTFUL_ADAPTOR_PROGRAM_ID must be fetched from:
 *   https://docs.ranger.finance/security/deployed-programs
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

  if (!process.env.TRUSTFUL_ADAPTOR_PROGRAM_ID) {
    throw new Error(
      "TRUSTFUL_ADAPTOR_PROGRAM_ID not set. " +
      "Get it from https://docs.ranger.finance/security/deployed-programs"
    );
  }

  const trustfulAdaptorId = new PublicKey(process.env.TRUSTFUL_ADAPTOR_PROGRAM_ID);
  const client            = new VoltrClient(connection);

  console.log("Adding Trustful adaptor...");
  console.log("  Program ID:", trustfulAdaptorId.toBase58());

  const ix = await client.createAddAdaptorIx({
    vault,
    payer:         adminKp.publicKey,
    admin:         adminKp.publicKey,
    adaptorProgram: trustfulAdaptorId,
  });

  const tx  = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [adminKp]);

  console.log("✅ Trustful adaptor added. Sig:", sig);
}

main().catch((e) => { console.error(e); process.exit(1); });
