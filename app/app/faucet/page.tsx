"use client";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { useCallback, useEffect, useState } from "react";
import { Footer, Header } from "@/components/ui";
import WalletButton from "@/components/WalletButton";
import { explorerTx, fromBase, PRIZE_MINT, PRIZE_SYMBOL } from "@/lib/format";
import { friendlyError } from "@/lib/tx";

export default function Faucet() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [sol, setSol] = useState<number | null>(null);
  const [usdc, setUsdc] = useState<bigint | null>(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [txLink, setTxLink] = useState("");

  const load = useCallback(async () => {
    if (!publicKey) return;
    setSol((await connection.getBalance(publicKey)) / LAMPORTS_PER_SOL);
    if (PRIZE_MINT) {
      const ata = getAssociatedTokenAddressSync(new PublicKey(PRIZE_MINT), publicKey);
      setUsdc(await getAccount(connection, ata).then((a) => a.amount).catch(() => 0n));
    }
  }, [publicKey, connection]);

  useEffect(() => { load().catch(() => {}); }, [load]);

  async function getSol() {
    if (!publicKey) return;
    setBusy("sol");
    setMsg("");
    try {
      const sig = await connection.requestAirdrop(publicKey, LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig, "confirmed");
      setMsg("1 devnet SOL sent.");
      await load();
    } catch {
      setMsg("The public airdrop is busy. Use faucet.solana.com with your address instead; it's free.");
    } finally {
      setBusy("");
    }
  }

  async function getUsdc() {
    if (!publicKey) return;
    setBusy("usdc");
    setMsg("");
    setTxLink("");
    try {
      const r = await fetch("/api/faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: publicKey.toBase58() }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      await load();
      setMsg(`${d.amount} test ${PRIZE_SYMBOL} sent. `);
      setTxLink(d.signature);
    } catch (e) {
      setMsg(friendlyError(e));
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <Header />
      <main className="wrap pad" style={{ maxWidth: 640 }}>
        <div className="sheet stack">
          <div className="sheet-head"><span>Devnet faucet</span><span>Free test money</span></div>
          <p>
            GeeClass runs on Solana devnet, where money is for testing only. To sponsor a battle you need test {PRIZE_SYMBOL} for
            the prize and a little devnet SOL for fees. Players only need the SOL.
          </p>
          {!publicKey ? (
            <WalletButton label="Connect wallet" block />
          ) : (
            <>
              <p className="muted small">
                Balance: {sol === null ? "…" : sol.toFixed(3)} SOL · {usdc === null ? "…" : fromBase(usdc)} {PRIZE_SYMBOL}
              </p>
              <div className="row">
                <button className="btn" disabled={!!busy} onClick={getSol}>{busy === "sol" ? "Requesting…" : "Get 1 devnet SOL"}</button>
                <button className="btn money" disabled={!!busy || !PRIZE_MINT} onClick={getUsdc}>{busy === "usdc" ? "Minting…" : `Get 100 test ${PRIZE_SYMBOL}`}</button>
              </div>
              {msg && (
                <p className="notice">
                  {msg}
                  {txLink && <a href={explorerTx(txLink)} target="_blank" rel="noreferrer">View transaction</a>}
                </p>
              )}
              <p className="hint">
                Make sure your wallet is on devnet. In Phantom: Settings, Developer Settings, Testnet Mode. In Solflare:
                Settings, Network, Devnet.
              </p>
            </>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
