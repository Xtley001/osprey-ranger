/**
 * reporting/logger.ts
 *
 * Structured logging to stdout + async Postgres writes.
 * Never throws — log failures should not kill keeper loops.
 */

import { Pool } from "pg";
import { config } from "../config";

const pool = new Pool({ connectionString: config.databaseUrl });

export async function initDb(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS keeper_logs (
      id        SERIAL PRIMARY KEY,
      timestamp TIMESTAMPTZ DEFAULT NOW(),
      level     TEXT NOT NULL,
      event     TEXT NOT NULL,
      message   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rebalance_log (
      id              SERIAL PRIMARY KEY,
      timestamp       TIMESTAMPTZ NOT NULL,
      regime          TEXT NOT NULL,
      total_nav       NUMERIC NOT NULL,
      hl_balance      NUMERIC NOT NULL,
      kamino_balance  NUMERIC NOT NULL,
      target_hl_pct   NUMERIC NOT NULL,
      actual_hl_pct   NUMERIC NOT NULL,
      delta           NUMERIC NOT NULL,
      funding_rate    NUMERIC NOT NULL,
      executed        BOOLEAN NOT NULL
    );

    CREATE TABLE IF NOT EXISTS nav_history (
      id             SERIAL PRIMARY KEY,
      timestamp      TIMESTAMPTZ DEFAULT NOW(),
      total_nav      NUMERIC NOT NULL,
      hl_value       NUMERIC NOT NULL,
      kamino_value   NUMERIC NOT NULL,
      asset_per_lp   NUMERIC,
      unrealised_pnl NUMERIC
    );
  `);
}

export function log(
  level:   "info" | "warn" | "error",
  event:   string,
  message: string,
): void {
  const line = `[${new Date().toISOString()}] [${level.toUpperCase().padEnd(5)}] [${event}] ${message}`;
  console.log(line);

  // Async write to postgres — don't await; don't block loops
  pool.query(
    "INSERT INTO keeper_logs (level, event, message) VALUES ($1, $2, $3)",
    [level, event, message],
  ).catch((err) => console.error("Log write failed:", err));
}

export interface RebalanceRecord {
  timestamp:     Date;
  regime:        string;
  totalNav:      number;
  hlBalance:     number;
  kaminoBalance: number;
  targetHlPct:   number;
  actualHlPct:   number;
  delta:         number;
  fundingRate:   number;
  executed:      boolean;
}

export async function logRebalance(record: RebalanceRecord): Promise<void> {
  await pool.query(
    `INSERT INTO rebalance_log
     (timestamp, regime, total_nav, hl_balance, kamino_balance,
      target_hl_pct, actual_hl_pct, delta, funding_rate, executed)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      record.timestamp, record.regime, record.totalNav,
      record.hlBalance, record.kaminoBalance, record.targetHlPct,
      record.actualHlPct, record.delta, record.fundingRate, record.executed,
    ],
  );
}

export async function logNav(
  totalNav:      number,
  hlValue:       number,
  kaminoValue:   number,
  assetPerLp:    number,
  unrealisedPnl: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO nav_history
     (total_nav, hl_value, kamino_value, asset_per_lp, unrealised_pnl)
     VALUES ($1,$2,$3,$4,$5)`,
    [totalNav, hlValue, kaminoValue, assetPerLp, unrealisedPnl],
  );
}
