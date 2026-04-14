/**
 * osprey/index.ts — barrel export for the Osprey wallet + HL trading layer
 *
 * Integration guide for the Osprey React app
 * ──────────────────────────────────────────────────────────────────────────
 *
 * 1. In your app entry (main.tsx or _app.tsx):
 *
 *    import { announceEIP6963Request } from "./osprey/wallet/walletUtils";
 *    announceEIP6963Request();  // must fire before first render
 *
 * 2. Wrap your root component with WalletProvider:
 *
 *    import { WalletProvider } from "./osprey/wallet/WalletContext";
 *
 *    root.render(
 *      <WalletProvider>
 *        <App />
 *      </WalletProvider>
 *    );
 *
 * 3. Add the wallet button anywhere in the UI:
 *
 *    import { WalletButton } from "./osprey/components/WalletButton";
 *    <WalletButton />
 *
 * 4. Optionally add the trade panel on signal/pair detail pages:
 *
 *    import { HlTradePanel } from "./osprey/components/HlTradePanel";
 *    <HlTradePanel coin="BTC" />
 *
 * 5. Install required deps (from the Osprey repo root):
 *
 *    npm install ethers @msgpack/msgpack
 *
 * ──────────────────────────────────────────────────────────────────────────
 */

export { WalletProvider, useWallet }   from "./wallet/WalletContext";
export { WalletButton }                from "./components/WalletButton";
export { WalletModal }                 from "./components/WalletModal";
export { HlTradePanel }                from "./components/HlTradePanel";
export { useHyperliquidSigning }       from "./hl/useHyperliquidSigning";
export { detectWallets, announceEIP6963Request, getWalletIcon } from "./wallet/walletUtils";
export type { WalletInfo }             from "./wallet/walletUtils";
export type { WalletState, WalletActions } from "./wallet/WalletContext";
export type { PlaceOrderParams, OrderResult, HlSignature } from "./hl/useHyperliquidSigning";
