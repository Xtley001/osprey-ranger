/**
 * osprey/components/WalletModal.tsx
 *
 * Wallet selection modal — shown when the user clicks "Connect Wallet"
 * or "Switch Wallet". Lists all detected EIP-1193 providers with icons.
 *
 * Usage:
 *   <WalletModal
 *     open={open}
 *     onClose={() => setOpen(false)}
 *     onConnect={async (walletId) => { await connect(walletId); }}
 *   />
 */

import React, { useEffect, useState } from "react";
import { detectWallets, getWalletIcon, WalletInfo } from "../wallet/walletUtils";

interface Props {
  open:      boolean;
  onClose:   () => void;
  onConnect: (walletId: string) => Promise<void>;
}

export function WalletModal({ open, onClose, onConnect }: Props) {
  const [wallets,     setWallets]     = useState<WalletInfo[]>([]);
  const [connecting,  setConnecting]  = useState<string | null>(null);
  const [error,       setError]       = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setWallets(detectWallets());
      setError(null);
      setConnecting(null);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open, onClose]);

  if (!open) return null;

  const handleConnect = async (wallet: WalletInfo) => {
    setConnecting(wallet.id);
    setError(null);
    try {
      await onConnect(wallet.id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Connection failed");
      setConnecting(null);
    }
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={styles.header}>
          <span style={styles.title}>Connect Wallet</span>
          <button style={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* Wallet list */}
        <div style={styles.list}>
          {wallets.length === 0 ? (
            <div style={styles.empty}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🦊</div>
              <div style={styles.emptyTitle}>No wallet detected</div>
              <div style={styles.emptyBody}>
                Install{" "}
                <a href="https://metamask.io" target="_blank" rel="noopener noreferrer" style={styles.link}>
                  MetaMask
                </a>
                {" "}and reload this page.
              </div>
            </div>
          ) : (
            wallets.map((wallet) => (
              <button
                key={wallet.id}
                style={{
                  ...styles.walletRow,
                  ...(connecting === wallet.id ? styles.walletRowActive : {}),
                }}
                onClick={() => handleConnect(wallet)}
                disabled={!!connecting}
                onMouseEnter={(e) => {
                  if (!connecting) Object.assign((e.currentTarget as HTMLElement).style, styles.walletRowHover);
                }}
                onMouseLeave={(e) => {
                  Object.assign((e.currentTarget as HTMLElement).style, styles.walletRow);
                }}
              >
                <img
                  src={getWalletIcon(wallet)}
                  alt={wallet.name}
                  style={styles.icon}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
                <div style={styles.walletInfo}>
                  <span style={styles.walletName}>{wallet.name}</span>
                  {wallet.isMetaMask && (
                    <span style={styles.badge}>Recommended</span>
                  )}
                </div>
                <span style={styles.arrow}>
                  {connecting === wallet.id ? "…" : "→"}
                </span>
              </button>
            ))
          )}
        </div>

        {error && (
          <div style={styles.error}>{error}</div>
        )}

        {/* Footer */}
        <div style={styles.footer}>
          <span style={styles.footerText}>
            By connecting you agree to interact with Hyperliquid at your own risk.
          </span>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position:       "fixed",
    inset:          0,
    background:     "rgba(0,0,0,0.65)",
    backdropFilter: "blur(4px)",
    zIndex:         2000,
    display:        "flex",
    alignItems:     "center",
    justifyContent: "center",
  },
  modal: {
    background:   "#16161e",
    border:       "1px solid rgba(255,255,255,0.1)",
    borderRadius: 16,
    width:        "100%",
    maxWidth:     420,
    boxShadow:    "0 24px 64px rgba(0,0,0,0.6)",
    overflow:     "hidden",
  },
  header: {
    display:        "flex",
    alignItems:     "center",
    justifyContent: "space-between",
    padding:        "20px 20px 12px",
    borderBottom:   "1px solid rgba(255,255,255,0.07)",
  },
  title: {
    color:      "#fff",
    fontSize:   18,
    fontWeight: 700,
  },
  closeBtn: {
    background:   "transparent",
    border:       "none",
    color:        "rgba(255,255,255,0.4)",
    fontSize:     16,
    cursor:       "pointer",
    padding:      4,
    lineHeight:   1,
    borderRadius: 4,
  },
  list: {
    padding:  "8px 12px",
    maxHeight: 320,
    overflowY: "auto",
  },
  walletRow: {
    display:        "flex",
    alignItems:     "center",
    gap:            12,
    width:          "100%",
    padding:        "12px 10px",
    background:     "transparent",
    border:         "1px solid transparent",
    borderRadius:   10,
    cursor:         "pointer",
    transition:     "background 0.12s, border-color 0.12s",
    marginBottom:   4,
  },
  walletRowHover: {
    display:        "flex",
    alignItems:     "center",
    gap:            12,
    width:          "100%",
    padding:        "12px 10px",
    background:     "rgba(99,102,241,0.1)",
    border:         "1px solid rgba(99,102,241,0.3)",
    borderRadius:   10,
    cursor:         "pointer",
    marginBottom:   4,
  },
  walletRowActive: {
    background:   "rgba(99,102,241,0.15)",
    border:       "1px solid rgba(99,102,241,0.4)",
    borderRadius: 10,
    opacity:      0.7,
    marginBottom: 4,
  },
  icon: {
    width: 36, height: 36, borderRadius: 8, flexShrink: 0,
  },
  walletInfo: {
    flex:        1,
    textAlign:   "left",
    display:     "flex",
    alignItems:  "center",
    gap:         8,
  },
  walletName: {
    color:      "#e2e8f0",
    fontSize:   15,
    fontWeight: 600,
  },
  badge: {
    background:   "rgba(16,185,129,0.15)",
    color:        "#6ee7b7",
    border:       "1px solid rgba(16,185,129,0.25)",
    borderRadius: 4,
    padding:      "1px 6px",
    fontSize:     11,
    fontWeight:   600,
  },
  arrow: {
    color:    "rgba(255,255,255,0.3)",
    fontSize: 16,
  },
  empty: {
    textAlign: "center",
    padding:   "32px 20px",
    color:     "rgba(255,255,255,0.5)",
  },
  emptyTitle: {
    fontSize:   16,
    fontWeight: 600,
    color:      "#e2e8f0",
    marginBottom: 8,
  },
  emptyBody: {
    fontSize: 13,
    lineHeight: 1.6,
  },
  link: {
    color:          "#818cf8",
    textDecoration: "none",
  },
  error: {
    margin:       "4px 16px 8px",
    padding:      "8px 12px",
    background:   "rgba(239,68,68,0.12)",
    border:       "1px solid rgba(239,68,68,0.25)",
    borderRadius: 8,
    color:        "#fca5a5",
    fontSize:     12,
  },
  footer: {
    padding:    "12px 20px",
    borderTop:  "1px solid rgba(255,255,255,0.07)",
    textAlign:  "center",
  },
  footerText: {
    color:    "rgba(255,255,255,0.3)",
    fontSize: 11,
  },
};
