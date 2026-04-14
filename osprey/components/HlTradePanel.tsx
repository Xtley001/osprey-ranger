/**
 * osprey/components/HlTradePanel.tsx
 *
 * Manual trade panel for placing / closing Hyperliquid perp orders
 * directly from the Osprey UI using the connected MetaMask wallet.
 *
 * Usage — drop inside any Osprey page or signal detail view:
 *
 *   import { HlTradePanel } from "../osprey/components/HlTradePanel";
 *   <HlTradePanel coin="BTC" />
 *
 * The panel signs orders via the connected wallet (MetaMask / any EIP-1193)
 * using the corrected EIP-712 scheme (msgpack + solidityPacked).
 */

import React, { useEffect, useState } from "react";
import { useWallet } from "../wallet/WalletContext";
import { useHyperliquidSigning } from "../hl/useHyperliquidSigning";
import { WalletButton } from "./WalletButton";

interface Props {
  /** Default coin to trade, e.g. "BTC", "NVDA" */
  coin?: string;
}

interface Position {
  coin:          string;
  szi:           string;
  entryPx:       string;
  unrealizedPnl: string;
  liquidationPx: string | null;
}

export function HlTradePanel({ coin: defaultCoin = "BTC" }: Props) {
  const { address, isConnecting } = useWallet();
  const {
    isReady,
    placeOrder,
    closePosition,
    fetchPositions,
    fetchOpenOrders,
  } = useHyperliquidSigning();

  const [coin,       setCoin]       = useState(defaultCoin.toUpperCase());
  const [side,       setSide]       = useState<"Short" | "Long">("Short");
  const [size,       setSize]       = useState("");
  const [price,      setPrice]      = useState("");
  const [orderType,  setOrderType]  = useState<"Limit" | "Market">("Limit");
  const [positions,  setPositions]  = useState<Position[]>([]);
  const [openOrders, setOpenOrders] = useState<any[]>([]);
  const [status,     setStatus]     = useState<{ msg: string; ok: boolean } | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [tab,        setTab]        = useState<"trade" | "positions" | "orders">("trade");

  // Load positions + orders when wallet connects
  useEffect(() => {
    if (!isReady) return;
    refreshData();
  }, [isReady]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshData = async () => {
    const [pos, orders] = await Promise.all([fetchPositions(), fetchOpenOrders()]);
    setPositions(pos as Position[]);
    setOpenOrders(orders);
  };

  const handleSubmit = async () => {
    if (!isReady) return;
    const sz = parseFloat(size);
    const px = parseFloat(price);
    if (!sz || sz <= 0) return setStatus({ msg: "Enter a valid size", ok: false });
    if (orderType === "Limit" && (!px || px <= 0)) return setStatus({ msg: "Enter a valid price", ok: false });

    setLoading(true);
    setStatus(null);

    const tif    = orderType === "Market" ? "Ioc" : "Alo";
    const isBuy  = side === "Long";
    const limitPx = orderType === "Market"
      ? (isBuy ? px * 1.005 : px * 0.995) // 0.5% slippage for market sim
      : px;

    const result = await placeOrder({ coin, isBuy, sz, px: limitPx, tif });

    setLoading(false);
    if (result.success) {
      setStatus({ msg: `✓ Order placed. ID: ${result.orderId}`, ok: true });
      setSize("");
      refreshData();
    } else {
      setStatus({ msg: `✗ ${result.error}`, ok: false });
    }
  };

  const handleClose = async (pos: Position) => {
    if (!isReady) return;
    setLoading(true);
    const result = await closePosition(pos.coin, parseFloat(pos.szi));
    setLoading(false);
    if (result.success) {
      setStatus({ msg: `✓ ${pos.coin} position closed`, ok: true });
      refreshData();
    } else {
      setStatus({ msg: `✗ ${result.error}`, ok: false });
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  if (!address) {
    return (
      <div style={s.card}>
        <div style={s.connectPrompt}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🦊</div>
          <p style={s.connectText}>Connect your wallet to place trades on Hyperliquid</p>
          <WalletButton />
        </div>
      </div>
    );
  }

  return (
    <div style={s.card}>
      {/* Header */}
      <div style={s.header}>
        <span style={s.headerTitle}>Trade on Hyperliquid</span>
        <WalletButton />
      </div>

      {/* Tabs */}
      <div style={s.tabs}>
        {(["trade", "positions", "orders"] as const).map((t) => (
          <button
            key={t}
            style={{ ...s.tab, ...(tab === t ? s.tabActive : {}) }}
            onClick={() => { setTab(t); if (t !== "trade") refreshData(); }}
          >
            {t === "trade" ? "Place Order" : t === "positions" ? `Positions (${positions.length})` : `Orders (${openOrders.length})`}
          </button>
        ))}
      </div>

      {/* ── Trade tab ─────────────────────────────────────────────────────── */}
      {tab === "trade" && (
        <div style={s.form}>
          {/* Coin input */}
          <div style={s.field}>
            <label style={s.label}>Coin</label>
            <input
              style={s.input}
              value={coin}
              onChange={(e) => setCoin(e.target.value.toUpperCase())}
              placeholder="BTC"
            />
          </div>

          {/* Side */}
          <div style={s.field}>
            <label style={s.label}>Side</label>
            <div style={s.segmented}>
              {(["Long", "Short"] as const).map((opt) => (
                <button
                  key={opt}
                  style={{
                    ...s.segBtn,
                    ...(side === opt
                      ? opt === "Long" ? s.segBtnLong : s.segBtnShort
                      : {}),
                  }}
                  onClick={() => setSide(opt)}
                >
                  {opt === "Long" ? "↑ Long" : "↓ Short"}
                </button>
              ))}
            </div>
          </div>

          {/* Order type */}
          <div style={s.field}>
            <label style={s.label}>Order Type</label>
            <div style={s.segmented}>
              {(["Limit", "Market"] as const).map((opt) => (
                <button
                  key={opt}
                  style={{ ...s.segBtn, ...(orderType === opt ? s.segBtnActive : {}) }}
                  onClick={() => setOrderType(opt)}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>

          {/* Size */}
          <div style={s.field}>
            <label style={s.label}>Size (contracts)</label>
            <input
              style={s.input}
              type="number"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              placeholder="0.01"
              min="0"
              step="any"
            />
          </div>

          {/* Price */}
          {orderType === "Limit" && (
            <div style={s.field}>
              <label style={s.label}>Limit Price (USD)</label>
              <input
                style={s.input}
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="95000"
                min="0"
                step="any"
              />
            </div>
          )}

          {/* Submit */}
          <button
            style={{
              ...s.submitBtn,
              ...(side === "Long" ? s.submitLong : s.submitShort),
              ...(loading || !isReady ? s.submitDisabled : {}),
            }}
            onClick={handleSubmit}
            disabled={loading || !isReady}
          >
            {loading ? "Signing…" : `${side === "Long" ? "↑ Buy" : "↓ Sell"} ${coin}`}
          </button>

          {status && (
            <div style={{ ...s.statusMsg, ...(status.ok ? s.statusOk : s.statusErr) }}>
              {status.msg}
            </div>
          )}

          <div style={s.disclaimer}>
            Orders are signed by your wallet via EIP-712 and submitted directly to Hyperliquid.
            Always verify details before confirming in MetaMask.
          </div>
        </div>
      )}

      {/* ── Positions tab ─────────────────────────────────────────────────── */}
      {tab === "positions" && (
        <div style={s.tableWrap}>
          {positions.length === 0 ? (
            <div style={s.empty}>No open positions</div>
          ) : (
            <table style={s.table}>
              <thead>
                <tr>
                  {["Coin", "Size", "Entry", "PnL", "Liq Price", ""].map((h) => (
                    <th key={h} style={s.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {positions.map((pos) => {
                  const pnl    = parseFloat(pos.unrealizedPnl);
                  const isShort = parseFloat(pos.szi) < 0;
                  return (
                    <tr key={pos.coin}>
                      <td style={s.td}>{pos.coin}</td>
                      <td style={{ ...s.td, color: isShort ? "#f87171" : "#6ee7b7" }}>
                        {isShort ? "↓ Short" : "↑ Long"} {Math.abs(parseFloat(pos.szi))}
                      </td>
                      <td style={s.td}>${parseFloat(pos.entryPx).toLocaleString()}</td>
                      <td style={{ ...s.td, color: pnl >= 0 ? "#6ee7b7" : "#f87171" }}>
                        {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
                      </td>
                      <td style={s.td}>{pos.liquidationPx ? `$${parseFloat(pos.liquidationPx).toLocaleString()}` : "—"}</td>
                      <td style={s.td}>
                        <button
                          style={s.closeBtn}
                          onClick={() => handleClose(pos)}
                          disabled={loading}
                        >
                          Close
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Open orders tab ───────────────────────────────────────────────── */}
      {tab === "orders" && (
        <div style={s.tableWrap}>
          {openOrders.length === 0 ? (
            <div style={s.empty}>No open orders</div>
          ) : (
            <table style={s.table}>
              <thead>
                <tr>
                  {["Coin", "Side", "Size", "Price"].map((h) => (
                    <th key={h} style={s.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {openOrders.map((o, i) => (
                  <tr key={i}>
                    <td style={s.td}>{o.coin}</td>
                    <td style={{ ...s.td, color: o.side === "B" ? "#6ee7b7" : "#f87171" }}>
                      {o.side === "B" ? "↑ Buy" : "↓ Sell"}
                    </td>
                    <td style={s.td}>{o.sz}</td>
                    <td style={s.td}>${parseFloat(o.px).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  card: {
    background:   "#16161e",
    border:       "1px solid rgba(255,255,255,0.08)",
    borderRadius: 14,
    overflow:     "hidden",
    fontFamily:   "system-ui, -apple-system, sans-serif",
  },
  header: {
    display:        "flex",
    alignItems:     "center",
    justifyContent: "space-between",
    padding:        "16px 18px",
    borderBottom:   "1px solid rgba(255,255,255,0.07)",
  },
  headerTitle: { color: "#e2e8f0", fontWeight: 700, fontSize: 15 },
  tabs: {
    display:        "flex",
    borderBottom:   "1px solid rgba(255,255,255,0.07)",
  },
  tab: {
    flex:       1,
    padding:    "10px 4px",
    background: "transparent",
    border:     "none",
    color:      "rgba(255,255,255,0.4)",
    fontSize:   12,
    fontWeight: 600,
    cursor:     "pointer",
    borderBottom: "2px solid transparent",
    transition: "color 0.15s, border-color 0.15s",
  },
  tabActive: {
    color:        "#818cf8",
    borderBottom: "2px solid #818cf8",
  },
  form: { padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 },
  field: { display: "flex", flexDirection: "column", gap: 5 },
  label: { color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.6 },
  input: {
    background:   "rgba(255,255,255,0.05)",
    border:       "1px solid rgba(255,255,255,0.12)",
    borderRadius: 8,
    padding:      "9px 12px",
    color:        "#e2e8f0",
    fontSize:     14,
    outline:      "none",
  },
  segmented: { display: "flex", gap: 6 },
  segBtn: {
    flex:         1,
    padding:      "8px 0",
    background:   "rgba(255,255,255,0.05)",
    border:       "1px solid rgba(255,255,255,0.1)",
    borderRadius: 7,
    color:        "rgba(255,255,255,0.5)",
    fontSize:     13,
    fontWeight:   600,
    cursor:       "pointer",
  },
  segBtnActive:  { background: "rgba(99,102,241,0.2)", border: "1px solid rgba(99,102,241,0.4)", color: "#a5b4fc" },
  segBtnLong:    { background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.3)", color: "#6ee7b7" },
  segBtnShort:   { background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.25)", color: "#f87171" },
  submitBtn: {
    width:        "100%",
    padding:      "12px",
    border:       "none",
    borderRadius: 9,
    fontSize:     15,
    fontWeight:   700,
    cursor:       "pointer",
    marginTop:    4,
    transition:   "opacity 0.15s",
  },
  submitLong:     { background: "#10b981", color: "#fff" },
  submitShort:    { background: "#ef4444", color: "#fff" },
  submitDisabled: { opacity: 0.4, cursor: "not-allowed" },
  statusMsg: {
    padding:      "9px 12px",
    borderRadius: 7,
    fontSize:     13,
    fontWeight:   500,
  },
  statusOk:  { background: "rgba(16,185,129,0.12)", color: "#6ee7b7", border: "1px solid rgba(16,185,129,0.2)" },
  statusErr: { background: "rgba(239,68,68,0.1)",   color: "#fca5a5", border: "1px solid rgba(239,68,68,0.2)" },
  disclaimer: {
    color:      "rgba(255,255,255,0.25)",
    fontSize:   11,
    lineHeight: 1.5,
    textAlign:  "center",
  },
  tableWrap: { padding: "12px 0", overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { color: "rgba(255,255,255,0.35)", fontSize: 11, fontWeight: 600, padding: "6px 14px", textAlign: "left", textTransform: "uppercase", letterSpacing: 0.5 },
  td: { color: "#cbd5e1", fontSize: 13, padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.04)" },
  closeBtn: {
    background:   "rgba(239,68,68,0.12)",
    border:       "1px solid rgba(239,68,68,0.25)",
    borderRadius: 5,
    color:        "#f87171",
    fontSize:     11,
    fontWeight:   600,
    padding:      "4px 10px",
    cursor:       "pointer",
  },
  empty: { textAlign: "center", color: "rgba(255,255,255,0.25)", padding: "32px 0", fontSize: 13 },
  connectPrompt: {
    display:        "flex",
    flexDirection:  "column",
    alignItems:     "center",
    padding:        "40px 24px",
    gap:            12,
  },
  connectText: {
    color:     "rgba(255,255,255,0.5)",
    fontSize:  14,
    textAlign: "center",
    margin:    0,
  },
};
