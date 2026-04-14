/**
 * 02-lp-metadata.ts
 * LP token metadata is set via Metaplex on the vault's LP mint.
 * The vault LP mint is derived from the vault address.
 */
import { VoltrClient } from "@voltr/vault-sdk";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const connection = new Connection(process.env.RPC_URL!, "confirmed");
  const client = new VoltrClient(connection);
  const vault = new PublicKey(process.env.VAULT_ADDRESS!);

  const lpMint = client.findVaultLpMint(vault);
  console.log("✅ LP Mint address:", lpMint.toBase58());
  console.log("\nMetadata URI:", process.env.METADATA_URI);
  console.log("\nLP metadata must be set via Metaplex separately.");
  console.log("Your LP mint is ready — proceed to script 03.");
}

main().catch((e) => { console.error(e); process.exit(1); });
