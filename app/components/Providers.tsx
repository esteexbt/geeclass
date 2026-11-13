"use client";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { useEffect, type ReactNode } from "react";

const RPC = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";

export default function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    // Lets Android phones (including Solana Seeker) connect through Mobile Wallet Adapter.
    import("@solana-mobile/wallet-standard-mobile")
      .then((m) =>
        m.registerMwa({
          appIdentity: { name: "GeeClass", uri: window.location.origin, icon: "/icon.svg" },
          authorizationCache: m.createDefaultAuthorizationCache(),
          chains: [RPC.includes("mainnet") ? "solana:mainnet" : "solana:devnet"],
          chainSelector: m.createDefaultChainSelector(),
          onWalletNotFound: m.createDefaultWalletNotFoundHandler(),
        }),
      )
      .catch(() => {});
  }, []);

  return (
    <ConnectionProvider endpoint={RPC}>
      {/* Empty list: wallets are discovered through the Wallet Standard (Phantom, Solflare, Backpack, MWA). */}
      <WalletProvider wallets={[]} autoConnect>
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
}
