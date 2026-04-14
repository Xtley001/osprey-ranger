/**
 * signal/client.ts
 *
 * Polls the Osprey /api/regime and /api/sizing endpoints.
 * Defaults to COLD on failure (safest fallback).
 */

import axios from "axios";
import { config } from "../config";
import { log } from "../reporting/logger";

export type RegimeLabel = "HOT" | "NEUTRAL" | "COLD";

export interface RegimeSignal {
  regime:            RegimeLabel;
  topPair:           string;
  annualizedFunding: number;   // e.g. 0.45 = 45% annualised
  medianTopOIFunding: number;
  confidence:        number;   // 0–1
  timestamp:         number;
}

export interface SizingSignal {
  recommendedHlAllocationPct: number;  // 0–1
  baseAllocationForRegime:    number;
  confidence:                 number;
  regime:                     RegimeLabel;
  timestamp:                  number;
}

const COLD_FALLBACK: RegimeSignal = {
  regime:            "COLD",
  topPair:           "BTC",
  annualizedFunding: 0,
  medianTopOIFunding: 0,
  confidence:        0,
  timestamp:         Date.now(),
};

export async function fetchRegime(): Promise<RegimeSignal> {
  try {
    const res = await axios.get<RegimeSignal>(
      `${config.ospreyApiUrl}/api/regime`,
      { timeout: 10_000 },
    );
    return res.data;
  } catch (err) {
    log("error", "signal.regime", `Failed to fetch regime: ${String(err)} — defaulting to COLD`);
    return { ...COLD_FALLBACK, timestamp: Date.now() };
  }
}

export async function fetchSizing(): Promise<SizingSignal> {
  try {
    const res = await axios.get<SizingSignal>(
      `${config.ospreyApiUrl}/api/sizing`,
      { timeout: 10_000 },
    );
    return res.data;
  } catch (err) {
    log("error", "signal.sizing", `Failed to fetch sizing: ${String(err)}`);
    return {
      recommendedHlAllocationPct: 0,
      baseAllocationForRegime:    0,
      confidence:                 0,
      regime:                     "COLD",
      timestamp:                  Date.now(),
    };
  }
}
