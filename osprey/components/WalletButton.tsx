/**
 * osprey/components/WalletButton.tsx
 *
 * Wallet connection button — drop this anywhere in the Osprey UI.
 *
 *   <WalletButton />
 *
 * Shows:
 *   - "Connect Wallet"        when no wallet is connected
 *   - "0x1234…abcd  ▾"       when connected (click to open menu)
 *   - Dropdown with: Switch Account | Copy Address | Disconnect
 */

import React, { useEffect, useRef, useState } from "react";
import { useWallet } from "../wallet/WalletContext";
import { WalletModal } from "./WalletModal";

export function WalletButton() {
  const {
    address,
    shortAddress,
    hlUsdcBalance,
    isConnecting,
    activeWallet,
    error,
    connect,
    disconnect,
    switchAccount,
    fetchHlBalance,
    clearError,
  } = useWallet();

  const [menuOpen,  setMenuOpen]  = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [copied,    setCopied]    = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handle = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [menuOpen]);

  // Fetch HL balance when address changes
  useEffect(() => {
    if (address) fetchHlBalance();
  }, [address, fetchHlBalance]);

  const copyAddress = () => {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Not connected ─────────────────────────────────────────────────────────────

  if (!address) {
    return (
      <>
        <button
          onClick={() => setModalOpen(true)}
          disabled={isConnecting}
          style={styles.connectBtn}
          onMouseEnter={(e) => Object.assign((e.target as HTMLElement).style, styles.connectBtnHover)}
          onMouseLeave={(e) => Object.assign((e.target as HTMLElement).style, styles.connectBtn)}
        >
          {isConnecting ? "Connecting…" : "Connect Wallet"}
        </button>

        {error && (
          <div style={styles.errorBadge} onClick={clearError}>
            {error} ✕
          </div>
        )}

        <WalletModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          onConnect={async (walletId) => {
            await connect(walletId);
            setModalOpen(false);
          }}
        />
      </>
    );
  }

  // ── Connected ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ position: "relative", display: "inline-block" }} ref={menuRef}>
      <button
        onClick={() => setMenuOpen((o) => !o)}
        style={styles.connectedBtn}
        onMouseEnter={(e) => Object.assign((e.target as HTMLElement).style, styles.connectedBtnHover)}
        onMouseLeave={(e) => Object.assign((e.target as HTMLElement).style, styles.connectedBtn)}
      >
        {activeWallet?.icon && (
          <img src={activeWallet.icon} alt="" style={styles.walletIcon} />
        )}
        <span>{shortAddress}</span>
        {hlUsdcBalance !== null && (
          <span style={styles.balanceBadge}>${hlUsdcBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        )}
        <span style={{ marginLeft: 4, opacity: 0.6, fontSize: 10 }}>▾</span>
      </button>

      {menuOpen && (
        <div style={styles.dropdown}>
          {/* Wallet name header */}
          <div style={styles.menuHeader}>
            {activeWallet?.name ?? "Wallet"}
          </div>

          {/* Switch Account */}
          <button
            style={styles.menuItem}
            onClick={() => { setMenuOpen(false); switchAccount(); }}
            onMouseEnter={(e) => Object.assign((e.target as HTMLElement).style, styles.menuItemHover)}
            onMouseLeave={(e) => Object.assign((e.target as HTMLElement).style, styles.menuItem)}
          >
            <span>⇄</span> Switch Account
          </button>

          {/* Switch Wallet */}
          <button
            style={styles.menuItem}
            onClick={() => { setMenuOpen(false); setModalOpen(true); }}
            onMouseEnter={(e) => Object.assign((e.target as HTMLElement).style, styles.menuItemHover)}
            onMouseLeave={(e) => Object.assign((e.target as HTMLElement).style, styles.menuItem)}
          >
            <span>🔀</span> Switch Wallet
          </button>

          {/* Copy Address */}
          <button
            style={styles.menuItem}
            onClick={() => { copyAddress(); setMenuOpen(false); }}
            onMouseEnter={(e) => Object.assign((e.target as HTMLElement).style, styles.menuItemHover)}
            onMouseLeave={(e) => Object.assign((e.target as HTMLElement).style, styles.menuItem)}
          >
            <span>{copied ? "✓" : "⧉"}</span> {copied ? "Copied!" : "Copy Address"}
          </button>

          <div style={styles.menuDivider} />

          {/* View on HL */}
          <a
            href={`https://app.hyperliquid.xyz/portfolio/${address}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ ...styles.menuItem, textDecoration: "none" } as React.CSSProperties}
            onClick={() => setMenuOpen(false)}
          >
            <span>↗</span> View on Hyperliquid
          </a>

          <div style={styles.menuDivider} />

          {/* Disconnect */}
          <button
            style={{ ...styles.menuItem, ...styles.menuItemDanger }}
            onClick={() => { setMenuOpen(false); disconnect(); }}
            onMouseEnter={(e) => Object.assign((e.target as HTMLElement).style, { ...styles.menuItem, ...styles.menuItemDangerHover })}
            onMouseLeave={(e) => Object.assign((e.target as HTMLElement).style, { ...styles.menuItem, ...styles.menuItemDanger })}
          >
            <span>⏻</span> Disconnect
          </button>
        </div>
      )}

      <WalletModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onConnect={async (walletId) => {
          await connect(walletId);
          setModalOpen(false);
        }}
      />
    </div>
  );
}

// ── Inline styles (no external CSS dependency) ────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  connectBtn: {
    background:   "#6366f1",
    color:        "#fff",
    border:       "none",
    borderRadius: 8,
    padding:      "8px 18px",
    fontSize:     14,
    fontWeight:   600,
    cursor:       "pointer",
    transition:   "background 0.15s",
  },
  connectBtnHover: {
    background:   "#4f46e5",
    color:        "#fff",
    border:       "none",
    borderRadius: 8,
    padding:      "8px 18px",
    fontSize:     14,
    fontWeight:   600,
    cursor:       "pointer",
  },
  connectedBtn: {
    display:        "flex",
    alignItems:     "center",
    gap:            6,
    background:     "rgba(99,102,241,0.12)",
    color:          "#c7d2fe",
    border:         "1px solid rgba(99,102,241,0.35)",
    borderRadius:   8,
    padding:        "7px 14px",
    fontSize:       13,
    fontWeight:     600,
    cursor:         "pointer",
    transition:     "background 0.15s",
  },
  connectedBtnHover: {
    display:        "flex",
    alignItems:     "center",
    gap:            6,
    background:     "rgba(99,102,241,0.22)",
    color:          "#e0e7ff",
    border:         "1px solid rgba(99,102,241,0.5)",
    borderRadius:   8,
    padding:        "7px 14px",
    fontSize:       13,
    fontWeight:     600,
    cursor:         "pointer",
  },
  walletIcon: {
    width: 18, height: 18, borderRadius: 4,
  },
  balanceBadge: {
    background:   "rgba(16,185,129,0.15)",
    color:        "#6ee7b7",
    borderRadius: 4,
    padding:      "1px 6px",
    fontSize:     12,
    fontWeight:   600,
  },
  dropdown: {
    position:    "absolute",
    top:         "calc(100% + 6px)",
    right:       0,
    minWidth:    200,
    background:  "#1e1e2e",
    border:      "1px solid rgba(255,255,255,0.1)",
    borderRadius: 10,
    boxShadow:   "0 8px 32px rgba(0,0,0,0.4)",
    zIndex:      1000,
    overflow:    "hidden",
    padding:     "4px 0",
  },
  menuHeader: {
    padding:    "10px 14px 6px",
    fontSize:   11,
    fontWeight: 600,
    color:      "rgba(255,255,255,0.35)",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  menuItem: {
    display:    "flex",
    alignItems: "center",
    gap:        8,
    width:      "100%",
    padding:    "9px 14px",
    background: "transparent",
    border:     "none",
    color:      "rgba(255,255,255,0.82)",
    fontSize:   13,
    fontWeight: 500,
    cursor:     "pointer",
    textAlign:  "left",
    transition: "background 0.1s",
  },
  menuItemHover: {
    display:    "flex",
    alignItems: "center",
    gap:        8,
    width:      "100%",
    padding:    "9px 14px",
    background: "rgba(255,255,255,0.06)",
    border:     "none",
    color:      "#fff",
    fontSize:   13,
    fontWeight: 500,
    cursor:     "pointer",
    textAlign:  "left",
  },
  menuDivider: {
    height:     1,
    background: "rgba(255,255,255,0.07)",
    margin:     "4px 0",
  },
  menuItemDanger: {
    color: "rgba(239,68,68,0.8)",
  },
  menuItemDangerHover: {
    background: "rgba(239,68,68,0.1)",
    color:      "#f87171",
  },
  errorBadge: {
    marginTop:    6,
    padding:      "5px 10px",
    background:   "rgba(239,68,68,0.15)",
    border:       "1px solid rgba(239,68,68,0.3)",
    borderRadius: 6,
    color:        "#fca5a5",
    fontSize:     12,
    cursor:       "pointer",
  },
};
