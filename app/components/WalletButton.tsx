"use client";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { short } from "@/lib/format";

export function useWalletPicker() {
  const [open, setOpen] = useState(false);
  return { open, setOpen };
}

export default function WalletButton({ label = "Connect wallet", block = false }: { label?: string; block?: boolean }) {
  const { wallets, select, publicKey, disconnect, connecting } = useWallet();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (publicKey) {
    return (
      <button className="btn ghost sm" onClick={() => disconnect()} title="Disconnect">
        {short(publicKey.toBase58())}
      </button>
    );
  }

  const usable = wallets.filter(
    (w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable,
  );

  return (
    <>
      <button className={`btn sm ${block ? "block" : ""}`} onClick={() => setOpen(true)} disabled={connecting}>
        {connecting ? "Connecting…" : label}
      </button>
      {open && mounted && createPortal(
        <div className="modal-back" role="dialog" aria-modal="true" aria-label="Choose a wallet" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="spread">
              <h3>Choose a wallet</h3>
              <button className="linkish" onClick={() => setOpen(false)}>Close</button>
            </div>
            {usable.length === 0 ? (
              <p className="mt-2 muted">
                No Solana wallet found in this browser. Install{" "}
                <a href="https://phantom.com/download" target="_blank" rel="noreferrer">Phantom</a> or{" "}
                <a href="https://solflare.com/download" target="_blank" rel="noreferrer">Solflare</a>, switch it to devnet, then
                reload. On a phone, open this page inside your wallet&apos;s browser.
              </p>
            ) : (
              usable.map((w) => (
                <button
                  key={w.adapter.name}
                  className="wallet-opt"
                  onClick={async () => {
                    setError("");
                    try {
                      select(w.adapter.name);
                      setOpen(false);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : String(e));
                    }
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={w.adapter.icon} alt="" />
                  {w.adapter.name}
                </button>
              ))
            )}
            {error && <p className="error mt-1">{error}</p>}
            <p className="hint mt-2">GeeClass is on Solana devnet. Use test funds only.</p>
          </div>
        </div>,
        // Rendered on <body> so no page section can ever cover the wallet picker.
        document.body,
      )}
    </>
  );
}
