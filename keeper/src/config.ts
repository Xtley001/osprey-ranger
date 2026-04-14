import * as dotenv from "dotenv";
dotenv.config();

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

/**
 * optional() — returns the value or empty string.
 * Used for addresses that are only known after vault-setup scripts 01–07 complete.
 * The keeper will warn at startup if these are blank, but won't crash — this lets
 * you start the keeper in dev/test before vault setup is fully wired.
 */
function optional(key: string, fallback = ""): string {
  return process.env[key] ?? fallback;
}

/**
 * warnIfMissing() — logs a warning for each blank optional address at startup.
 * Call this from main() after the config is imported.
 */
export function warnMissingAddresses(): void {
  const optionalKeys = [
    "VAULT_ADDRESS",
    "KAMINO_STRATEGY_ADDRESS",
    "TRUSTFUL_STRATEGY_ADDRESS",
    "KAMINO_ADAPTOR_PROGRAM_ID",
    "TRUSTFUL_ADAPTOR_PROGRAM_ID",
    "KAMINO_COUNTER_PARTY_TA",
    "KAMINO_COUNTER_PARTY_TA_AUTH",
    "KAMINO_PROTOCOL_PROGRAM",
  ];
  const missing = optionalKeys.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.warn(
      `[config] WARNING: The following addresses are not yet set — fill them in after vault-setup:\n  ${missing.join("\n  ")}`
    );
  }
}

export const config = {
  // ── Required on first boot ──────────────────────────────────────────────────
  rpcUrl:          required("RPC_URL"),
  adminKeypair:    JSON.parse(required("ADMIN_KEYPAIR") || "[]") as number[],
  managerKeypair:  JSON.parse(required("MANAGER_KEYPAIR") || "[]") as number[],
  usdcMint:        required("USDC_MINT"),
  hlApiUrl:        required("HL_API_URL"),
  hlPrivateKey:    required("HL_PRIVATE_KEY"),
  hlWalletAddress: required("HL_WALLET_ADDRESS"),
  ospreyApiUrl:    required("OSPREY_API_URL"),
  databaseUrl:     required("DATABASE_URL"),

  // ── Populated after vault-setup scripts 01–07 ───────────────────────────────
  // These will be empty strings until you run vault-setup and fill them in.
  // warnMissingAddresses() will flag any blanks at startup.
  vaultAddress:            optional("VAULT_ADDRESS"),
  kaminoStrategyAddress:   optional("KAMINO_STRATEGY_ADDRESS"),
  trustfulStrategyAddress: optional("TRUSTFUL_STRATEGY_ADDRESS"),

  // Adaptor program IDs — verify from docs.ranger.finance/security/deployed-programs
  kaminoAdaptorProgramId:   optional("KAMINO_ADAPTOR_PROGRAM_ID"),
  kaminoCounterPartyTa:     optional("KAMINO_COUNTER_PARTY_TA"),
  kaminoCounterPartyTaAuth: optional("KAMINO_COUNTER_PARTY_TA_AUTH"),
  kaminoProtocolProgram:    optional("KAMINO_PROTOCOL_PROGRAM"),

  // Trustful adaptor address — verify from docs.ranger.finance
  trustfulAdaptorProgramId: optional("TRUSTFUL_ADAPTOR_PROGRAM_ID"),

  // ── Loop intervals (ms) ─────────────────────────────────────────────────────
  rebalanceInterval:    15 * 60 * 1000,   // 15 minutes
  markToMarketInterval: 60 * 60 * 1000,   // 1 hour
  riskMonitorInterval:   5 * 60 * 1000,   // 5 minutes
} as const;
