/**
 * osprey/wallet/walletUtils.ts
 *
 * Detects all injected EIP-1193 wallets available in the browser.
 * EIP-6963 (multi-wallet standard) is preferred; falls back to window.ethereum.
 */

export interface WalletInfo {
  id:       string;
  name:     string;
  icon:     string;   // data-URI SVG/PNG or empty string
  provider: any;      // EIP-1193 provider
  isMetaMask:    boolean;
  isCoinbase:    boolean;
  isRabby:       boolean;
}

// EIP-6963 event types
interface EIP6963ProviderDetail {
  info: {
    uuid:  string;
    name:  string;
    icon:  string;
    rdns:  string;
  };
  provider: any;
}

/**
 * Synchronously detect all wallets.
 * Uses EIP-6963 announcements (modern) + window.ethereum (legacy fallback).
 * Call on page load or when the user opens the wallet modal.
 */
export function detectWallets(): WalletInfo[] {
  const wallets: WalletInfo[] = [];
  const seen = new Set<string>();

  // ── EIP-6963 (modern multi-wallet standard) ────────────────────────────────
  // Wallets fire this event in response to "eip6963:requestProvider"
  if (typeof window !== "undefined" && (window as any).__eip6963Providers) {
    for (const detail of (window as any).__eip6963Providers as EIP6963ProviderDetail[]) {
      if (seen.has(detail.info.uuid)) continue;
      seen.add(detail.info.uuid);
      wallets.push({
        id:         detail.info.uuid,
        name:       detail.info.name,
        icon:       detail.info.icon,
        provider:   detail.provider,
        isMetaMask: detail.info.rdns === "io.metamask",
        isCoinbase: detail.info.rdns === "com.coinbase.wallet",
        isRabby:    detail.info.rdns === "io.rabby",
      });
    }
  }

  // ── Legacy window.ethereum fallback ──────────────────────────────────────────
  if (typeof window !== "undefined" && (window as any).ethereum && wallets.length === 0) {
    const eth = (window as any).ethereum;
    const isMetaMask = !!eth.isMetaMask && !eth.isBraveWallet;
    const isCoinbase = !!eth.isCoinbaseWallet;

    // If there are multiple injected providers (window.ethereum.providers[])
    const providers: any[] = eth.providers ?? [eth];

    for (const p of providers) {
      const name = p.isMetaMask && !p.isBraveWallet
        ? "MetaMask"
        : p.isCoinbaseWallet
        ? "Coinbase Wallet"
        : p.isBraveWallet
        ? "Brave Wallet"
        : p.isRabby
        ? "Rabby"
        : "Browser Wallet";

      const id = `legacy_${name.toLowerCase().replace(/\s/g, "_")}`;
      if (seen.has(id)) continue;
      seen.add(id);

      wallets.push({
        id,
        name,
        icon:       "",
        provider:   p,
        isMetaMask: !!p.isMetaMask && !p.isBraveWallet,
        isCoinbase: !!p.isCoinbaseWallet,
        isRabby:    !!p.isRabby,
      });
    }
  }

  // MetaMask first, then alphabetical
  return wallets.sort((a, b) => {
    if (a.isMetaMask && !b.isMetaMask) return -1;
    if (!a.isMetaMask && b.isMetaMask) return 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Fire EIP-6963 request so wallets announce themselves.
 * Call this once early (e.g. in main.tsx) before the first detectWallets() call.
 */
export function announceEIP6963Request(): void {
  if (typeof window === "undefined") return;

  // Collect announcements into a global array so detectWallets() can read them sync
  if (!(window as any).__eip6963Providers) {
    (window as any).__eip6963Providers = [];
  }

  window.addEventListener("eip6963:announceProvider", (e: Event) => {
    const detail = (e as CustomEvent<EIP6963ProviderDetail>).detail;
    const existing = (window as any).__eip6963Providers as EIP6963ProviderDetail[];
    if (!existing.find((d) => d.info.uuid === detail.info.uuid)) {
      existing.push(detail);
    }
  });

  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

/**
 * Built-in SVG icons for common wallets (used when EIP-6963 icon is missing).
 */
export function getWalletIcon(wallet: WalletInfo): string {
  if (wallet.icon) return wallet.icon;

  if (wallet.isMetaMask) return METAMASK_ICON;
  if (wallet.isCoinbase) return COINBASE_ICON;
  return GENERIC_WALLET_ICON;
}

// ── Inline icons (data URIs) ─────────────────────────────────────────────────

const METAMASK_ICON = `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMTggMzE4IiB3aWR0aD0iMzIiIGhlaWdodD0iMzIiPjxwYXRoIGZpbGw9IiNFMjc2MUIiIGQ9Ik0xNjAgMTIuN0wzMTguMiAyNjkuM0gwdjBMMTYwIDEyLjd6Ii8+PHBhdGggZmlsbD0iI0UyNzYxQiIgZD0iTTE2MCAxMi43TDAgMjY5LjNsMTYwIDE4IDAtMjc0LjZ6Ii8+PHBhdGggZmlsbD0iI0Q3NjAzMCIgZD0iTTE2MCAxMi43bDAgMjc0LjYgMTU4LjItMTguMUwxNjAgMTIuN3oiLz48L3N2Zz4=`;

const COINBASE_ICON = `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiIgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIj48Y2lyY2xlIGN4PSIxNiIgY3k9IjE2IiByPSIxNiIgZmlsbD0iIzAwNTJGRiIvPjxwYXRoIGZpbGw9IndoaXRlIiBkPSJNMTYgOGE4IDggMCAxIDAgMCAxNiA4IDggMCAwIDAgMC0xNnptMCA2LjVhMS41IDEuNSAwIDEgMSAwIDMgMS41IDEuNSAwIDAgMSAwLTN6Ii8+PC9zdmc+`;

const GENERIC_WALLET_ICON = `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIj48cmVjdCB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHJ4PSI2IiBmaWxsPSIjNjM2NkYxIi8+PHBhdGggZmlsbD0id2hpdGUiIGQ9Ik00IDhoMTZ2MUg0em0wIDRoMTZ2MUg0em0wIDRoMTB2MUg0eiIvPjwvc3ZnPg==`;
