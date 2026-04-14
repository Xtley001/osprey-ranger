import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { VoltrClient } from "@voltr/vault-sdk";
import { config } from "../config";

export function getVaultPubkey(): PublicKey {
  return new PublicKey(config.vaultAddress);
}

export function getKaminoStrategyPubkey(): PublicKey {
  return new PublicKey(config.kaminoStrategyAddress);
}

export function getTrustfulStrategyPubkey(): PublicKey {
  return new PublicKey(config.trustfulStrategyAddress);
}

export function getManagerKeypair(): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(config.managerKeypair));
}

export function buildClient(connection: Connection): VoltrClient {
  const managerKp = getManagerKeypair();
  return new VoltrClient(connection, managerKp);
}

export async function getVaultTotalValue(client: VoltrClient): Promise<number> {
  const { totalValue } = await client.getPositionAndTotalValuesForVault(getVaultPubkey());
  // totalValue is in USDC lamports (6 decimals)
  return Number(totalValue) / 1_000_000;
}
