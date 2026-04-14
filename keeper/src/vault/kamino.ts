import {
  Connection,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
  Signer,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { VoltrClient } from "@voltr/vault-sdk";
import { BN } from "bn.js";
import { config } from "../config";
import { getVaultPubkey, getKaminoStrategyPubkey, getManagerKeypair } from "./client";
import { log } from "../reporting/logger";

// Addresses sourced from config (which validates them at startup)
// Verify values from: https://github.com/voltrxyz/kamino-scripts
// and https://docs.ranger.finance/security/deployed-programs
const KAMINO_ADAPTOR_PROGRAM_ID = new PublicKey(config.kaminoAdaptorProgramId);
const KAMINO_COUNTER_PARTY_TA   = new PublicKey(config.kaminoCounterPartyTa);
const KAMINO_COUNTER_PARTY_TA_AUTH = new PublicKey(config.kaminoCounterPartyTaAuth);
const KAMINO_PROTOCOL_PROGRAM   = new PublicKey(config.kaminoProtocolProgram);

async function sendWithRetry(
  connection: Connection,
  tx: Transaction,
  signers: Signer[],
  maxRetries = 3,
): Promise<string> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await sendAndConfirmTransaction(connection, tx, signers, {
        commitment: "confirmed",
      });
    } catch (e) {
      if (attempt === maxRetries) throw e;
      log("warn", "tx.retry", `Attempt ${attempt} failed, retrying in ${attempt}s: ${String(e)}`);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw new Error("unreachable");
}

export async function depositKamino(
  client: VoltrClient,
  connection: Connection,
  amountUsdc: number,
): Promise<string> {
  const amountLamports = new BN(Math.floor(amountUsdc * 1_000_000));
  const vault     = getVaultPubkey();
  const strategy  = getKaminoStrategyPubkey();
  const managerKp = getManagerKeypair();
  const usdcMint  = new PublicKey(config.usdcMint);

  log("info", "kamino.deposit", `Depositing ${amountUsdc.toFixed(2)} USDC to Kamino`);

  const ix = await client.createDepositStrategyIx(
    {
      depositAmount:            amountLamports,
      instructionDiscriminator: null,
      additionalArgs:           null,
    },
    {
      manager:           managerKp.publicKey,
      vault,
      vaultAssetMint:    usdcMint,
      strategy,
      assetTokenProgram: TOKEN_PROGRAM_ID,
      adaptorProgram:    KAMINO_ADAPTOR_PROGRAM_ID,
      remainingAccounts: [
        { pubkey: KAMINO_COUNTER_PARTY_TA,   isSigner: false, isWritable: true  },
        { pubkey: KAMINO_PROTOCOL_PROGRAM,   isSigner: false, isWritable: false },
      ],
    },
  );

  const tx  = new Transaction().add(ix);
  const sig = await sendWithRetry(connection, tx, [managerKp]);
  log("info", "kamino.deposit", `Deposited. Sig: ${sig}`);
  return sig;
}

export async function withdrawKamino(
  client: VoltrClient,
  connection: Connection,
  amountUsdc: number,
): Promise<string> {
  const amountLamports = new BN(Math.floor(amountUsdc * 1_000_000));
  const vault     = getVaultPubkey();
  const strategy  = getKaminoStrategyPubkey();
  const managerKp = getManagerKeypair();
  const usdcMint  = new PublicKey(config.usdcMint);

  log("info", "kamino.withdraw", `Withdrawing ${amountUsdc.toFixed(2)} USDC from Kamino`);

  const ix = await client.createWithdrawStrategyIx(
    {
      withdrawAmount:           amountLamports,
      instructionDiscriminator: null,
      additionalArgs:           null,
    },
    {
      manager:           managerKp.publicKey,
      vault,
      vaultAssetMint:    usdcMint,
      strategy,
      assetTokenProgram: TOKEN_PROGRAM_ID,
      adaptorProgram:    KAMINO_ADAPTOR_PROGRAM_ID,
      remainingAccounts: [
        { pubkey: KAMINO_COUNTER_PARTY_TA_AUTH, isSigner: false, isWritable: true  },
        { pubkey: KAMINO_COUNTER_PARTY_TA,      isSigner: false, isWritable: true  },
        { pubkey: KAMINO_PROTOCOL_PROGRAM,      isSigner: false, isWritable: false },
      ],
    },
  );

  const tx  = new Transaction().add(ix);
  const sig = await sendWithRetry(connection, tx, [managerKp]);
  log("info", "kamino.withdraw", `Withdrawn. Sig: ${sig}`);
  return sig;
}
