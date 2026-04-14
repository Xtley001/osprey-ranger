/**
 * osprey/wallet/WalletContext.tsx
 *
 * EVM wallet state for the Osprey frontend.
 * Supports MetaMask, Coinbase Wallet, and any EIP-1193 injected provider.
 *
 * Features:
 *  - Auto-detect all injected wallets on page load
 *  - Connect / disconnect
 *  - Switch accounts at will (triggers MetaMask account picker)
 *  - Switch networks
 *  - Persist connection across page refreshes (localStorage)
 *  - Listen for account / chain changes from the wallet extension
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ethers } from "ethers";
import { detectWallets, WalletInfo } from "./walletUtils";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WalletState {
  /** Currently connected wallet address (checksummed) */
  address: string | null;
  /** Shortened address for display: 0x1234…abcd */
  shortAddress: string | null;
  /** Chain ID of connected network */
  chainId: number | null;
  /** USDC balance on Hyperliquid (populated after fetchHlBalance) */
  hlUsdcBalance: number | null;
  /** All injected wallets detected in the browser */
  availableWallets: WalletInfo[];
  /** The currently active wallet provider */
  activeWallet: WalletInfo | null;
  /** ethers BrowserProvider for signing */
  provider: ethers.BrowserProvider | null;
  /** ethers Signer — use for EIP-712 signTypedData */
  signer: ethers.JsonRpcSigner | null;
  /** True while a connect/switch operation is in progress */
  isConnecting: boolean;
  /** Last error message, if any */
  error: string | null;
}

export interface WalletActions {
  /** Open wallet picker and connect */
  connect: (walletId?: string) => Promise<void>;
  /** Disconnect and clear all state */
  disconnect: () => void;
  /** Request MetaMask to open account switcher */
  switchAccount: () => Promise<void>;
  /** Request a network change */
  switchNetwork: (chainId: number) => Promise<void>;
  /** Fetch the HL account USDC balance for the connected address */
  fetchHlBalance: () => Promise<void>;
  /** Clear the current error */
  clearError: () => void;
}

const defaultState: WalletState = {
  address: null,
  shortAddress: null,
  chainId: null,
  hlUsdcBalance: null,
  availableWallets: [],
  activeWallet: null,
  provider: null,
  signer: null,
  isConnecting: false,
  error: null,
};

const WalletCtx = createContext<WalletState & WalletActions>({
  ...defaultState,
  connect: async () => {},
  disconnect: () => {},
  switchAccount: async () => {},
  switchNetwork: async () => {},
  fetchHlBalance: async () => {},
  clearError: () => {},
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const LAST_WALLET_KEY = "osprey_last_wallet";

function shorten(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<WalletState>(defaultState);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Detect available wallets on mount
  useEffect(() => {
    const wallets = detectWallets();
    setState((s) => ({ ...s, availableWallets: wallets }));
  }, []);

  // Auto-reconnect to last used wallet on page load
  useEffect(() => {
    const lastWalletId = localStorage.getItem(LAST_WALLET_KEY);
    if (lastWalletId) {
      connectToWallet(lastWalletId, /* silent */ true).catch(() => {
        // Silently fail on auto-reconnect (user may have locked wallet)
        localStorage.removeItem(LAST_WALLET_KEY);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Internal connect ─────────────────────────────────────────────────────────

  const connectToWallet = useCallback(
    async (walletId: string, silent = false) => {
      const wallets = detectWallets();
      const wallet  = wallets.find((w) => w.id === walletId) ?? wallets[0];
      if (!wallet) {
        setState((s) => ({ ...s, error: "No EVM wallet found. Install MetaMask." }));
        return;
      }

      setState((s) => ({ ...s, isConnecting: true, error: null }));

      try {
        const rawProvider = wallet.provider as ethers.Eip1193Provider;
        const ethersProvider = new ethers.BrowserProvider(rawProvider);

        // Request accounts — triggers MetaMask unlock/connect popup
        const method = silent ? "eth_accounts" : "eth_requestAccounts";
        const accounts: string[] = await rawProvider.request({ method });

        if (!accounts.length) {
          setState((s) => ({ ...s, isConnecting: false }));
          return;
        }

        const address  = ethers.getAddress(accounts[0]);
        const network  = await ethersProvider.getNetwork();
        const signer   = await ethersProvider.getSigner(address);

        // Cleanup previous listeners
        if (cleanupRef.current) cleanupRef.current();

        // Listen for account changes from the wallet extension
        const handleAccountsChanged = async (newAccounts: string[]) => {
          if (!newAccounts.length) {
            disconnect();
            return;
          }
          const newAddress = ethers.getAddress(newAccounts[0]);
          const newSigner  = await ethersProvider.getSigner(newAddress);
          setState((s) => ({
            ...s,
            address:      newAddress,
            shortAddress: shorten(newAddress),
            signer:       newSigner,
            hlUsdcBalance: null,
          }));
        };

        const handleChainChanged = (chainIdHex: string) => {
          setState((s) => ({ ...s, chainId: parseInt(chainIdHex, 16) }));
        };

        const handleDisconnect = () => disconnect();

        rawProvider.on?.("accountsChanged", handleAccountsChanged);
        rawProvider.on?.("chainChanged", handleChainChanged);
        rawProvider.on?.("disconnect", handleDisconnect);

        cleanupRef.current = () => {
          rawProvider.removeListener?.("accountsChanged", handleAccountsChanged);
          rawProvider.removeListener?.("chainChanged", handleChainChanged);
          rawProvider.removeListener?.("disconnect", handleDisconnect);
        };

        localStorage.setItem(LAST_WALLET_KEY, wallet.id);

        setState((s) => ({
          ...s,
          address,
          shortAddress:  shorten(address),
          chainId:       Number(network.chainId),
          availableWallets: wallets,
          activeWallet:  wallet,
          provider:      ethersProvider,
          signer,
          isConnecting:  false,
          error:         null,
        }));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setState((s) => ({
          ...s,
          isConnecting: false,
          error: msg.includes("User rejected") ? "Connection rejected." : msg,
        }));
      }
    },
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ── Public actions ────────────────────────────────────────────────────────────

  const connect = useCallback(
    async (walletId?: string) => {
      const wallets = detectWallets();
      const id = walletId ?? wallets[0]?.id;
      if (!id) {
        setState((s) => ({ ...s, error: "No EVM wallet detected. Please install MetaMask." }));
        return;
      }
      await connectToWallet(id, false);
    },
    [connectToWallet]
  );

  const disconnect = useCallback(() => {
    if (cleanupRef.current) cleanupRef.current();
    cleanupRef.current = null;
    localStorage.removeItem(LAST_WALLET_KEY);
    setState((s) => ({
      ...defaultState,
      availableWallets: s.availableWallets,
    }));
  }, []);

  /**
   * Triggers MetaMask's built-in account picker.
   * The user can select any account they have — no page reload needed.
   */
  const switchAccount = useCallback(async () => {
    if (!state.activeWallet) {
      await connect();
      return;
    }
    try {
      // wallet_requestPermissions forces MetaMask to show the account picker
      await state.activeWallet.provider.request({
        method: "wallet_requestPermissions",
        params: [{ eth_accounts: {} }],
      });
      // accountsChanged event fires automatically — state updates via listener
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("User rejected")) {
        setState((s) => ({ ...s, error: msg }));
      }
    }
  }, [state.activeWallet, connect]);

  const switchNetwork = useCallback(
    async (chainId: number) => {
      if (!state.activeWallet) return;
      try {
        await state.activeWallet.provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: `0x${chainId.toString(16)}` }],
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setState((s) => ({ ...s, error: msg }));
      }
    },
    [state.activeWallet]
  );

  const fetchHlBalance = useCallback(async () => {
    if (!state.address) return;
    try {
      const res = await fetch("https://api.hyperliquid.xyz/info", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ type: "clearinghouseState", user: state.address }),
      });
      const data = await res.json() as { marginSummary?: { accountValue?: string } };
      const balance = parseFloat(data?.marginSummary?.accountValue ?? "0");
      setState((s) => ({ ...s, hlUsdcBalance: balance }));
    } catch {
      // Non-fatal — balance display just stays null
    }
  }, [state.address]);

  const clearError = useCallback(() => {
    setState((s) => ({ ...s, error: null }));
  }, []);

  const value = useMemo(
    () => ({
      ...state,
      connect,
      disconnect,
      switchAccount,
      switchNetwork,
      fetchHlBalance,
      clearError,
    }),
    [state, connect, disconnect, switchAccount, switchNetwork, fetchHlBalance, clearError]
  );

  return <WalletCtx.Provider value={value}>{children}</WalletCtx.Provider>;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useWallet() {
  return useContext(WalletCtx);
}
