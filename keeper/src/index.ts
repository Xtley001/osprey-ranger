import http from "http";
import { Connection, Keypair } from "@solana/web3.js";
import { VoltrClient } from "@voltr/vault-sdk";
import { config, warnMissingAddresses } from "./config";
import { rebalanceLoop } from "./strategy/rebalancer";
import { markToMarketLoop } from "./reporting/markToMarket";
import { riskMonitorLoop } from "./risk/monitor";
import { initDb, log } from "./reporting/logger";
import { getVaultPubkey } from "./vault/client";

async function main() {
  log("info", "keeper.start", "Keeper bot starting");

  // Warn about any blank post-vault-setup addresses (won't crash, just inform)
  warnMissingAddresses();

  await initDb();

  const connection = new Connection(config.rpcUrl, "confirmed");
  const managerKp  = Keypair.fromSecretKey(Uint8Array.from(config.managerKeypair));
  const client     = new VoltrClient(connection, managerKp);

  // Only validate vault if address is set (it won't be before vault-setup is done)
  if (config.vaultAddress) {
    const vaultPubkey  = getVaultPubkey();
    const vaultAccount = await client.fetchVaultAccount(vaultPubkey);
    log("info", "keeper.vault", `Vault verified. Manager: ${vaultAccount.roles.manager.toBase58()}`);
  } else {
    log("warn", "keeper.vault", "VAULT_ADDRESS not set — skipping vault verification. Fill in keeper/.env after vault-setup.");
  }

  // Start all loops — each runs independently; errors are logged but do not kill siblings
  runLoop("rebalance",      config.rebalanceInterval,    () => rebalanceLoop(client, connection));
  runLoop("mark-to-market", config.markToMarketInterval, () => markToMarketLoop(client, connection));
  runLoop("risk-monitor",   config.riskMonitorInterval,  () => riskMonitorLoop(client, connection));

  // Health check endpoint for Render
  // render.yaml declares healthCheckPath: /health
  const port = process.env.PORT ?? 3001;
  http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
    } else {
      res.writeHead(404);
      res.end();
    }
  }).listen(port, () => {
    log("info", "keeper.health", `Health endpoint listening on :${port}/health`);
  });

  log("info", "keeper.start", "All loops running");
}

function runLoop(name: string, intervalMs: number, fn: () => Promise<void>): void {
  const tick = async () => {
    try {
      await fn();
    } catch (err) {
      log("error", `keeper.loop.${name}`, `Loop error: ${String(err)}`);
    }
  };

  tick();
  setInterval(tick, intervalMs);
}

main().catch((err) => {
  console.error("Fatal keeper error:", err);
  process.exit(1);
});
