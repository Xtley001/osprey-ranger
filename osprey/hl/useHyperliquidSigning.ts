/**
 * osprey/hl/useHyperliquidSigning.ts
 *
 * Browser-side Hyperliquid EIP-712 signing hook.
 * Uses the connected MetaMask wallet (BrowserProvider + Signer).
 *
 * Signing scheme — identical to the keeper bot:
 *   actionHash   = keccak256(msgpack(action))          ← NOT JSON.stringify
 *   connectionId = keccak256(solidityPacked([...]))     ← NOT ABI-padded
 *
 * This is the corrected implementation. The old version used JSON + ABI encoding
 * which produced signatures that HL's matching engine rejects.
 */

import { ethers } from "ethers";
import { encode as msgpackEncode } from "@msgpack/msgpack";
import { useWallet } from "../wallet/WalletContext";

export interface HlSignature {
  r: string;
  s: string;
  v: number;
}

export interface PlaceOrderParams {
  coin:        string;
  isBuy:       boolean;
  sz:          number;
  px:          number;
  tif?:        "Ioc" | "Gtc" | "Alo";
  reduceOnly?: boolean;
}

export interface OrderResult {
  success: boolean;
  orderId?: string;
  error?: string;
}

const HL_API = "https://api.hyperliquid.xyz";

// ── Core signing function ─────────────────────────────────────────────────────

async function signHyperliquidAction(
  signer:       ethers.JsonRpcSigner,
  action:       unknown,
  nonce:        number,
  vaultAddress: string | null = null,
): Promise<HlSignature> {
  // ✅ msgpack encode — matches HL on-chain verification
  const encoded    = msgpackEncode(action);
  const actionHash = ethers.keccak256(encoded);

  // ✅ solidityPacked — tight encoding, no 32-byte ABI padding
  const connectionId = ethers.keccak256(
    ethers.solidityPacked(
      ["bytes32", "uint64", "address"],
      [actionHash, BigInt(nonce), vaultAddress ?? ethers.ZeroAddress],
    ),
  );

  const domain = {
    name:              "Exchange",
    version:           "1",
    chainId:           1337,  // HL always uses 1337
    verifyingContract: "0x0000000000000000000000000000000000000000",
  };

  const types = {
    Agent: [
      { name: "source",       type: "string"  },
      { name: "connectionId", type: "bytes32" },
    ],
  };

  // ethers.Signer.signTypedData uses eth_signTypedData_v4 under the hood
  const sig = await signer.signTypedData(domain, types, {
    source: "a",
    connectionId,
  });

  const { r, s, v } = ethers.Signature.from(sig);
  return { r, s, v };
}

// ── Universe cache (shared across hook instances) ─────────────────────────────

interface AssetInfo { index: number; szDecimals: number; markPx: number }
let _universeCache: Map<string, AssetInfo> | null = null;
let _universeFetchedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // refresh every 5 min

async function getUniverse(): Promise<Map<string, AssetInfo>> {
  if (_universeCache && Date.now() - _universeFetchedAt < CACHE_TTL_MS) {
    return _universeCache;
  }
  const res  = await fetch(`${HL_API}/info`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "metaAndAssetCtxs" }),
  });
  const data = await res.json() as [
    { universe: { name: string; szDecimals: number }[] },
    { markPx: string; funding: string }[]
  ];
  const map = new Map<string, AssetInfo>();
  data[0].universe.forEach((asset, i) => {
    map.set(asset.name.toUpperCase(), {
      index:      i,
      szDecimals: asset.szDecimals,
      markPx:     parseFloat(data[1][i]?.markPx ?? "0"),
    });
  });
  _universeCache    = map;
  _universeFetchedAt = Date.now();
  return map;
}

function formatPx(v: number): string {
  return parseFloat(v.toPrecision(6)).toString();
}

function formatSz(v: number, dec: number): string {
  return v.toFixed(dec).replace(/\.?0+$/, "") || "0";
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useHyperliquidSigning() {
  const { signer, address } = useWallet();

  const isReady = !!signer && !!address;

  /**
   * Place a limit order on Hyperliquid using the connected wallet.
   * Works identically to the keeper's placeOrder but uses MetaMask for signing.
   */
  const placeOrder = async (params: PlaceOrderParams): Promise<OrderResult> => {
    if (!signer || !address) {
      return { success: false, error: "Wallet not connected" };
    }

    try {
      const universe  = await getUniverse();
      const assetInfo = universe.get(params.coin.toUpperCase());
      if (!assetInfo) {
        return { success: false, error: `Unknown coin: ${params.coin}` };
      }

      const nonce  = Date.now();
      const tif    = params.tif ?? "Alo";

      const action = {
        type:   "order",
        orders: [{
          a:  assetInfo.index,
          b:  params.isBuy,
          p:  formatPx(params.px),
          s:  formatSz(params.sz, assetInfo.szDecimals),
          r:  params.reduceOnly ?? false,
          t:  { limit: { tif } },
        }],
        grouping: "na",
      };

      const { r, s, v } = await signHyperliquidAction(signer, action, nonce, null);

      const res = await fetch(`${HL_API}/exchange`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, nonce, signature: { r, s, v }, vaultAddress: null }),
      });

      const data = await res.json() as {
        status: string;
        response?: { data?: { statuses?: Array<{ error?: string; resting?: { oid: number }; filled?: { oid: number } }> } };
      };

      if (data.status === "ok") {
        const status = data.response?.data?.statuses?.[0];
        if (status?.error) return { success: false, error: status.error };
        const orderId = (status?.resting?.oid ?? status?.filled?.oid)?.toString();
        return { success: true, orderId };
      }

      return { success: false, error: JSON.stringify(data) };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // User-friendly message for rejection
      if (msg.includes("user rejected") || msg.includes("User rejected")) {
        return { success: false, error: "Signature rejected by wallet." };
      }
      return { success: false, error: msg };
    }
  };

  /**
   * Cancel an open order.
   */
  const cancelOrder = async (coin: string, orderId: number): Promise<OrderResult> => {
    if (!signer || !address) return { success: false, error: "Wallet not connected" };

    try {
      const universe  = await getUniverse();
      const assetInfo = universe.get(coin.toUpperCase());
      if (!assetInfo) return { success: false, error: `Unknown coin: ${coin}` };

      const nonce  = Date.now();
      const action = {
        type:    "cancel",
        cancels: [{ a: assetInfo.index, o: orderId }],
      };

      const { r, s, v } = await signHyperliquidAction(signer, action, nonce, null);

      const res = await fetch(`${HL_API}/exchange`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, nonce, signature: { r, s, v }, vaultAddress: null }),
      });

      const data = await res.json() as { status: string };
      return { success: data.status === "ok", error: data.status !== "ok" ? JSON.stringify(data) : undefined };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  };

  /**
   * Close an entire position with a market-ish IOC order.
   */
  const closePosition = async (coin: string, sizeSigned: number): Promise<OrderResult> => {
    if (!signer || !address) return { success: false, error: "Wallet not connected" };

    const universe  = await getUniverse();
    const assetInfo = universe.get(coin.toUpperCase());
    if (!assetInfo) return { success: false, error: `Unknown coin: ${coin}` };

    const isBuy   = sizeSigned < 0;              // closing a short = buy
    const sz      = Math.abs(sizeSigned);
    const markPx  = assetInfo.markPx;
    const slippage = 0.005;                       // 0.5% slippage for IOC close
    const limitPx  = isBuy ? markPx * (1 + slippage) : markPx * (1 - slippage);

    return placeOrder({ coin, isBuy, sz, px: limitPx, tif: "Ioc", reduceOnly: true });
  };

  /**
   * Fetch open positions for the connected address.
   */
  const fetchPositions = async () => {
    if (!address) return [];
    const res  = await fetch(`${HL_API}/info`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "clearinghouseState", user: address }),
    });
    const data = await res.json() as {
      assetPositions: Array<{
        position: {
          coin: string; szi: string; entryPx: string;
          unrealizedPnl: string; liquidationPx: string | null;
        };
      }>;
    };
    return data.assetPositions
      .filter((p) => parseFloat(p.position.szi) !== 0)
      .map((p) => p.position);
  };

  /**
   * Fetch open orders for the connected address.
   */
  const fetchOpenOrders = async () => {
    if (!address) return [];
    const res  = await fetch(`${HL_API}/info`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "openOrders", user: address }),
    });
    return await res.json() as Array<{
      coin: string; side: string; sz: string; px: string; oid: number;
    }>;
  };

  return {
    isReady,
    placeOrder,
    cancelOrder,
    closePosition,
    fetchPositions,
    fetchOpenOrders,
  };
}
