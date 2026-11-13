"use client";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { QRCodeSVG } from "qrcode.react";
import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bubble, Header, LETTERS } from "@/components/ui";
import WalletButton from "@/components/WalletButton";
import { Countdown, Leaderboard, Podium, VerifyPanel } from "@/components/battle";
import { cancelBattleIx, settleBattleIxs } from "@/lib/geeclass";
import { fromBase, money, PRIZE_SYMBOL, splitLabel } from "@/lib/format";
import { finishLine, lobbyLine, questionLine, revealLine } from "@/lib/hostLines";
import { friendlyError, sendIxs } from "@/lib/tx";
import { useBattle } from "@/lib/useBattle";
import { useVoice } from "@/lib/useVoice";

export default function HostStage({ params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = use(params);
  const code = raw.toUpperCase();
  const [hostKey, setHostKey] = useState<string | undefined>();
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    setHostKey(localStorage.getItem(`geeclass:host:${code}`) ?? undefined);
    setChecked(true);
  }, [code]);

  if (!checked) return null;
  if (!hostKey)
    return (
      <div className="stage">
        <Header dark />
        <main className="wrap pad stack">
          <h2>This isn&apos;t your stage</h2>
          <p className="muted">Only the device that created battle {code} can host it.</p>
          <Link className="btn" href={`/b/${code}`}>Open the player view</Link>
        </main>
      </div>
    );
  return <Stage code={code} hostKey={hostKey} />;
}

function Stage({ code, hostKey }: { code: string; hostKey: string }) {
  const { state, error, refresh, now } = useBattle(code, { hostKey });
  const { connection } = useConnection();
  const wallet = useWallet();
  const voice = useVoice();
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const spoken = useRef("");
  const joinUrl = typeof window !== "undefined" ? `${window.location.origin}/b/${code}` : "";

  // The voice host reacts to each new moment of the battle.
  useEffect(() => {
    if (!state) return;
    const key = `${state.phase}-${state.qIndex}`;
    if (spoken.current === key || state.phase === "lobby") return;
    spoken.current = key;
    if (state.phase === "question") voice.say(questionLine(state));
    if (state.phase === "reveal") voice.say(revealLine(state));
    if (state.phase === "finished") voice.say(finishLine(state));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.phase, state?.qIndex]);

  async function act(action: "start" | "next") {
    setErr("");
    voice.unlock();
    setBusy(action);
    try {
      if (action === "start" && state) voice.say(lobbyLine(state));
      const r = await fetch(`/api/battles/${code}/host`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostKey, action }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      await refresh();
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy("");
    }
  }

  async function payWinners() {
    if (!state?.chain) return;
    setErr("");
    if (!wallet.publicKey) return setErr("Connect the host wallet to pay out.");
    if (wallet.publicKey.toBase58() !== state.chain.host) return setErr("Switch to the wallet that created this battle.");
    try {
      setBusy("pay");
      const plan = await fetch(`/api/battles/${code}/host`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostKey, action: "plan" }),
      }).then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        return d as { winners: { wallet: string }[]; resultsHash: string };
      });
      const mint = new PublicKey(state.chain.mint);
      const battle = new PublicKey(state.chain.battle);
      const sponsor = new PublicKey(state.chain.sponsor);
      const resultsHash = Uint8Array.from(plan.resultsHash.match(/../g)!.map((h) => parseInt(h, 16)));

      const ixs = settleBattleIxs({
        host: wallet.publicKey,
        battle,
        sponsor,
        mint,
        winners: plan.winners.map((w) => new PublicKey(w.wallet)),
        resultsHash,
      });
      const sig = await sendIxs(connection, wallet, ixs);
      for (let i = 0; i < 6; i++) {
        const r = await fetch(`/api/battles/${code}/host`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hostKey, action: "settled", tx: sig }),
        });
        if (r.ok) break;
        await new Promise((res) => setTimeout(res, 2000));
      }
      voice.say(`Done. The prize is in the winners' wallets. Congratulations!`);
      await refresh();
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy("");
    }
  }

  async function cancelAndRefund() {
    if (!state?.chain || !wallet.publicKey) return setErr("Connect the sponsor wallet first.");
    setBusy("cancel");
    setErr("");
    try {
      await sendIxs(connection, wallet, [
        cancelBattleIx(wallet.publicKey, new PublicKey(state.chain.battle), new PublicKey(state.chain.mint)),
      ]);
      setErr("Battle cancelled. The full prize is back in your wallet.");
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy("");
    }
  }

  if (error && !state)
    return (
      <div className="stage">
        <Header dark />
        <main className="wrap pad"><p className="error">{error}</p></main>
      </div>
    );
  if (!state) return <div className="stage" />;

  if (!state.chain)
    return (
      <div className="stage">
        <Header dark />
        <main className="wrap pad stack">
          <h2>Waiting for the prize to lock</h2>
          <p className="muted">This battle exists but hasn&apos;t been funded onchain yet. Go back to the create page and finish funding.</p>
        </main>
      </div>
    );

  const chain = state.chain;
  const q = state.question;
  const voiceToggle = (
    <button className="btn ghost sm" onClick={() => { voice.setEnabled(!voice.enabled); voice.stop(); }} aria-pressed={voice.enabled}>
      {voice.enabled ? "Voice on" : "Voice off"}
    </button>
  );

  return (
    <div className="stage">
      <Header dark right={voiceToggle} />
      <main className="wrap pad" style={{ position: "relative" }}>
        {state.phase === "lobby" && (
          <div className="grid-2">
            <div className="stack" style={{ ["--stack" as string]: "22px" }}>
              <div>
                <p className="muted">{state.sponsorName} presents</p>
                <h1 style={{ fontSize: "clamp(2.2rem,6vw,4rem)" }}>{state.title}</h1>
              </div>
              <div>
                <p className="muted">Join at {joinUrl.replace(/^https?:\/\//, "")} with code</p>
                <p className="code-big">{code}</p>
              </div>
              <div className="pot">
                <p className="small" style={{ fontWeight: 700 }}>Prize locked onchain</p>
                <p className="pot-amount">{money(chain.prizeAmount, chain.decimals)}</p>
                <p className="small mt-1">Split {splitLabel(chain.payoutBps)} · {state.total} questions · {state.secondsPerQuestion}s each</p>
              </div>
              <div>
                <h3>{state.players.length} {state.players.length === 1 ? "player" : "players"} in</h3>
                <div className="players mt-1">
                  {state.players.map((p) => <span key={p.wallet} className="player-chip">{p.name}</span>)}
                  {state.players.length === 0 && <p className="muted">Waiting for the first player…</p>}
                </div>
              </div>
              {err && <p className="notice">{err}</p>}
              <div className="row">
                <button className="btn money" disabled={!!busy || state.players.length === 0} onClick={() => act("start")}>
                  {busy === "start" ? "Starting…" : "Start the battle"}
                </button>
                {state.players.length === 0 && (
                  wallet.publicKey ? (
                    <button className="btn ghost" disabled={!!busy} onClick={cancelAndRefund}>Cancel and refund</button>
                  ) : <WalletButton label="Connect to cancel" />
                )}
              </div>
            </div>
            <div className="center">
              <div className="qr"><QRCodeSVG value={joinUrl} size={220} fgColor="#1C1F45" bgColor="#FBFDFA" /></div>
              <p className="muted small mt-1">Scan to join</p>
            </div>
          </div>
        )}

        {(state.phase === "question" || state.phase === "reveal") && q && (
          <div className="stack" style={{ ["--stack" as string]: "22px" }}>
            <div className="spread">
              <span className="muted">Question {state.qIndex + 1} of {state.total}</span>
              <span className="muted">{state.answeredThisQ} / {state.players.length} answered</span>
            </div>
            {state.phase === "question" ? (
              <Countdown endsAt={state.qEndsAt} total={state.secondsPerQuestion} now={now} />
            ) : (
              <p className="muted">Time&apos;s up</p>
            )}
            <p className="stage-q">{q.q}</p>
            <div className="opts-grid wide">
              {q.options.map((o, i) => {
                const reveal = state.phase === "reveal";
                const right = reveal && q.answer === i;
                return (
                  <div key={i} className={`option ${right ? "is-correct" : reveal ? "is-wrong" : ""}`}>
                    <Bubble letter={LETTERS[i]} state={right ? "correct" : "empty"} />
                    {o}
                    {reveal && <span className="count">{q.counts?.[i] ?? 0}</span>}
                  </div>
                );
              })}
            </div>
            {state.phase === "reveal" && (
              <div className="grid-2">
                <div className="stack">
                  {q.explain && <p className="notice">{q.explain}</p>}
                  <button className="btn money" disabled={!!busy} onClick={() => act("next")}>
                    {state.qIndex + 1 >= state.total ? "See final results" : "Next question"}
                  </button>
                </div>
                <div>
                  <h3>Standings</h3>
                  <Leaderboard board={state.board} limit={5} />
                </div>
              </div>
            )}
            {err && <p className="notice">{err}</p>}
          </div>
        )}

        {state.phase === "finished" && (
          <div className="grid-2">
            <div className="stack" style={{ ["--stack" as string]: "20px" }}>
              <h1 style={{ fontSize: "clamp(2.4rem,7vw,4.4rem)" }}>{state.settleTx ? "Paid out." : "Final results"}</h1>
              <Podium board={state.board} chain={chain} />
              {!state.settleTx ? (
                <div className="stack">
                  <p className="muted">
                    Paying out sends each winner their share straight from the vault and returns anything left to the
                    sponsor. You pay a few cents of devnet SOL in fees.
                  </p>
                  {wallet.publicKey ? (
                    <button className="btn money" disabled={!!busy} onClick={payWinners}>
                      {busy === "pay" ? "Paying winners…" : `Pay winners ${fromBase(chain.prizeAmount, chain.decimals)} ${PRIZE_SYMBOL}`}
                    </button>
                  ) : (
                    <WalletButton label="Connect host wallet to pay" />
                  )}
                </div>
              ) : (
                <p className="notice">The prize is in the winners&apos; wallets. Every step is public on Solana.</p>
              )}
              {err && <p className="notice">{err}</p>}
              <div>
                <h3>Full scoreboard</h3>
                <Leaderboard board={state.board} limit={50} />
              </div>
            </div>
            <div className="sheet">
              <VerifyPanel
                chain={chain}
                quizCommit={state.quizCommit}
                revealedQuiz={state.revealedQuiz}
                resultsHash={state.resultsHash}
                settleTx={state.settleTx}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
