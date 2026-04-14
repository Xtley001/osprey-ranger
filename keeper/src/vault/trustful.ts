import {
  Connection,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { VoltrClient } from "@voltr/vault-sdk";
import { BN } from "bn.js";
import { config } from "../config";
import { getVaultPubkey, getTrustfulStrategyPubkey, getManagerKeypair } from "./client";
import { log } from "../reporting/logger";

// Verify from: https://github.com/voltrxyz/trustful-scripts
// and https://docs.ranger.finance/security/deployed-programs
const TRUSTFUL_ADAPTOR_PROGRAM_ID = new PublicKey(process.env.TRUSTFUL_ADAPTOR_PROGRAM_ID!);

/**
 * markTrustfulValue — tells the vault what the Trustful strategy's current value is.
 *
 * The Trustful adaptor records off-chain position values on-chain.
 * This is NOT a fund transfer — it marks the HL account's current equity
 * into vault NAV so LP token price reflects real HL account state.
 *
 * Call this every hour (markToMarketInterval).
 *
 * @param currentHlValueUsdc — current USDC equity in HL account (balance + unrealised PnL)
 */
export async function markTrustfulValue(
  client: VoltrClient,
  connection: Connection,
  currentHlValueUsdc: number,
): Promise<string> {
  const amountLamports = new BN(Math.floor(currentHlValueUsdc * 1_000_000));
  const vault     = getVaultPubkey();
  const strategy  = getTrustfulStrategyPubkey();
  const managerKp = getManagerKeypair();
  const usdcMint  = new PublicKey(config.usdcMint);

  log("info", "trustful.mark", `Marking HL position to ${currentHlValueUsdc.toFixed(2)} USDC`);

  // Trustful deposit instruction = mark-to-market (does not move funds)
  // Verify remainingAccounts from trustful-scripts repo
  const ix = await client.createDepositStrategyIx(
    {
      depositAmount:            amountLamports,
      instructionDiscriminator: null,
      additionalArgs:           null,
    },
    {
      manager:          managerKp.publicKey,
      vault,
      vaultAssetMint:   usdcMint,
      strategy,
      assetTokenProgram: TOKEN_PROGRAM_ID,
      adaptorProgram:   TRUSTFUL_ADAPTOR_PROGRAM_ID,
      remainingAccounts: [], // verify from trustful-scripts before running
    },
  );

  const tx  = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [managerKp]);
  log("info", "trustful.mark", `Marked. Sig: ${sig}`);
  return sig;
}
