/**
 * exchange/hyperliquid.ts
 *
 * Server-side Hyperliquid REST client.
 * EIP-712 signing uses ethers.Wallet (no MetaMask dependency).
 *
 * Signing scheme follows the official HL protocol:
 *   actionHash   = keccak256(msgpack(action))
 *   connectionId = keccak256(solidityPacked(["bytes32","uint64","address"], [...]))
 */

import { ethers } from "ethers";
import { encode as msgpackEncode } from "@msgpack/msgpack";
import axios from "axios";
import { config } from "../config";

const BASE_URL = config.hlApiUrl;

const _coinIndexCache: Map<string, number> = new Map();
const _coinSzDecimals: Map<string, number> = new Map();

// ── Formatting helpers ────────────────────────────────────────────────────────

function formatPx(value: number): string {
  return parseFloat(value.toPrecision(6)).toString();
}

function formatSz(value: number, szDecimals: number): string {
  return value.toFixed(szDecimals).replace(/\.?0+$/, "") || "0";
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

export async function hlPost(endpoint: string, payload: object): Promise<unknown> {
  const res = await axios.post(`${BASE_URL}${endpoint}`, payload, {
    headers: { "Content-Type": "application/json" },
  });
  return res.data;
}

export async function hlInfo(request: object): Promise<unknown> {
  const res = await axios.post(`${BASE_URL}/info`, request, {
    headers: { "Content-Type": "application/json" },
  });
  return res.data;
}

// ── Universe cache ────────────────────────────────────────────────────────────

async function ensureUniverseCached(): Promise<void> {
  if (_coinIndexCache.size > 0) return;
  const data = await hlInfo({ type: "meta" }) as { universe: HlMeta[] };
  data.universe.forEach((asset, i) => {
    _coinIndexCache.set(asset.name.toUpperCase(), i);
    _coinSzDecimals.set(asset.name.toUpperCase(), asset.szDecimals);
  });
}

export async function getCoinIndex(coin: string): Promise<number> {
  await ensureUniverseCached();
  const idx = _coinIndexCache.get(coin.toUpperCase());
  if (idx === undefined) throw new Error(`Coin not in HL universe: ${coin}`);
  return idx;
}

export function getCoinSzDecimals(coin: string): number {
  return _coinSzDecimals.get(coin.toUpperCase()) ?? 4;
}

// ── Account queries ───────────────────────────────────────────────────────────

export async function getAccountState(address: string): Promise<HlAccountState> {
  return (await hlInfo({ type: "clearinghouseState", user: address })) as HlAccountState;
}

export async function getPositions(address: string): Promise<HlPosition[]> {
  const state = await getAccountState(address);
  return state.assetPositions
    .filter((p) => parseFloat(p.position.szi) !== 0)
    .map((p) => p.position);
}

export async function getHlUsdcBalance(address: string): Promise<number> {
  const state = await getAccountState(address);
  return parseFloat(state.marginSummary.accountValue);
}

export async function getFundingRate(coin: string): Promise<number> {
  await ensureUniverseCached();
  const data = await hlInfo({ type: "metaAndAssetCtxs" }) as [
    { universe: HlMeta[] },
    HlAssetCtx[]
  ];
  const idx = _coinIndexCache.get(coin.toUpperCase());
  if (idx === undefined) return 0;
  return parseFloat(data[1][idx]?.funding ?? "0");
}

/**
 * Get the live mark price for a coin.
 * Used for liquidation proximity checks and position sizing.
 */
export async function getMarkPrice(coin: string): Promise<number> {
  await ensureUniverseCached();
  const data = await hlInfo({ type: "metaAndAssetCtxs" }) as [
    { universe: HlMeta[] },
    HlAssetCtx[]
  ];
  const idx = _coinIndexCache.get(coin.toUpperCase());
  if (idx === undefined) throw new Error(`Coin not in HL universe: ${coin}`);
  const markPx = parseFloat(data[1][idx]?.markPx ?? "0");
  if (markPx <= 0) throw new Error(`Invalid mark price for ${coin}: ${markPx}`);
  return markPx;
}

// ── EIP-712 signing ───────────────────────────────────────────────────────────
//
// HL protocol:
//   actionHash   = keccak256(msgpack(action))          — NOT JSON.stringify
//   connectionId = keccak256(solidityPacked([...]))     — NOT ABI-padded encode
//
// Reference: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/signing

const wallet = new ethers.Wallet(config.hlPrivateKey);

export async function signHyperliquidAction(
  action:       unknown,
  nonce:        number,
  vaultAddress: string | null = null,
): Promise<{ r: string; s: string; v: number }> {

  // ✅ msgpack — matches HL on-chain verification
  const encoded    = msgpackEncode(action);
  const actionHash = ethers.keccak256(encoded);

  // ✅ solidityPacked — tight encoding, no 32-byte padding per slot
  const connectionId = ethers.keccak256(
    ethers.solidityPacked(
      ["bytes32", "uint64", "address"],
      [actionHash, BigInt(nonce), vaultAddress ?? ethers.ZeroAddress],
    ),
  );

  const domain = {
    name:              "Exchange",
    version:           "1",
    chainId:           1337,
    verifyingContract: "0x0000000000000000000000000000000000000000",
  };

  const types = {
    Agent: [
      { name: "source",       type: "string"  },
      { name: "connectionId", type: "bytes32" },
    ],
  };

  const sig = await wallet.signTypedData(domain, types, {
    source: "a",
    connectionId,
  });

  const { r, s, v } = ethers.Signature.from(sig);
  return { r, s, v };
}

// ── Order placement ───────────────────────────────────────────────────────────

export type OrderTif = "Ioc" | "Gtc" | "Alo";

export interface OrderResult {
  success: boolean;
  orderId?: string;
  filledAsMaker?: boolean;
  error?: string;
}

export async function placeOrder(params: {
  coin:        string;
  isBuy:       boolean;
  sz:          number;
  px:          number;
  tif?:        OrderTif;
  reduceOnly?: boolean;
}): Promise<OrderResult> {
  try {
    const tif        = params.tif ?? "Alo";
    const assetIndex = await getCoinIndex(params.coin);
    const szDecimals = getCoinSzDecimals(params.coin);
    const nonce      = Date.now();

    const action = {
      type:   "order",
      orders: [{
        a:  assetIndex,
        b:  params.isBuy,
        p:  formatPx(params.px),
        s:  formatSz(params.sz, szDecimals),
        r:  params.reduceOnly ?? false,
        t:  { limit: { tif } },
      }],
      grouping: "na",
    };

    const { r, s, v } = await signHyperliquidAction(action, nonce, null);

    const res = await hlPost("/exchange", {
      action,
      nonce,
      signature: { r, s, v },
      vaultAddress: null,
    }) as { status: string; response?: { data?: { statuses?: Array<{ error?: string; resting?: { oid: number }; filled?: { oid: number } }> } } };

    if (res.status === "ok") {
      const status = res.response?.data?.statuses?.[0];
      if (status?.error) return { success: false, error: status.error };
      const orderId       = (status?.resting?.oid ?? status?.filled?.oid)?.toString();
      const filledAsMaker = !!status?.resting;
      return { success: true, orderId, filledAsMaker };
    }

    return { success: false, error: JSON.stringify(res) };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HlAccountState {
  marginSummary: {
    accountValue:    string;
    totalNtlPos:     string;
    totalRawUsd:     string;
    totalMarginUsed: string;
  };
  assetPositions: Array<{ position: HlPosition }>;
}

export interface HlPosition {
  coin:           string;
  szi:            string;
  entryPx:        string;
  unrealizedPnl:  string;
  returnOnEquity: string;
  liquidationPx:  string | null;
  marginUsed:     string;
  leverage:       { type: string; value: number };
}

export interface HlMeta {
  name:       string;
  szDecimals: number;
}

export interface HlAssetCtx {
  funding:      string;
  openInterest: string;
  prevDayPx:    string;
  dayNtlVlm:    string;
  markPx:       string;
  midPx:        string | null;
  impactPxs:    string[] | null;
}
