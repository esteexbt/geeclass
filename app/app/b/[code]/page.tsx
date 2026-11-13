"use client";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { Bubble, Footer, Header, LETTERS } from "@/components/ui";
import WalletButton from "@/components/WalletButton";
import { Countdown, Leaderboard, Podium, prizeFor, VerifyPanel } from "@/components/battle";
import { entryExists, joinBattleIx } from "@/lib/geeclass";
import { explorerTx, fromBase, money, PRIZE_SYMBOL, splitLabel } from "@/lib/format";
import { friendlyError, sendIxs } from "@/lib/tx";
import { useBattle } from "@/lib/useBattle";
import { readRes } from "@/lib/http";

export default function PlayerPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = use(params);
  const code = raw.toUpperCase();
  const wallet = useWallet();
  const me = wallet.publicKey?.toBase58();
  const { connection } = useConnection();
  const { state, error, refresh, now } = useBattle(code, { wallet: me });

  const tokenKey = me ? `geeclass:player:${code}:${me}` : "";
  const [token, setToken] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [picked, setPicked] = useState<{ qi: number; choice: number } | null>(null);

  useEffect(() => {
    setToken(tokenKey ? localStorage.getItem(tokenKey) : null);
    setName(localStorage.getItem("geeclass:name") ?? "");
  }, [tokenKey]);

  const joined = !!token && !!state?.players.some((p) => p.wallet === me);
  const isOrganizer = !!me && !!state?.chain && (me === state.chain.host || me === state.chain.sponsor);

  async function join() {
    if (!wallet.publicKey || !state?.chain) return;
    setErr("");
    const clean = name.trim();
    if (clean.length < 2) return setErr("Pick a name with at least 2 characters.");
    localStorage.setItem("geeclass:name", clean);
    setBusy("Approve in your wallet…");
    try {
      const battle = new PublicKey(state.chain.battle);
      let sig: string | undefined;
      if (!(await entryExists(connection, battle, wallet.publicKey))) {
        sig = await sendIxs(connection, wallet, [joinBattleIx(wallet.publicKey, battle).ix]);
      }
      setBusy("Taking your seat…");
      for (let i = 0; i < 6; i++) {
        const r = await fetch(`/api/battles/${code}/join`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wallet: wallet.publicKey.toBase58(), name: clean, joinTx: sig }),
        });
        const d = await readRes<{ token: string; error?: string }>(r);
        if (r.ok) {
          localStorage.setItem(tokenKey, d.token);
          setToken(d.token);
          await refresh();
          return;
        }
        if (r.status !== 409 || /started/.test(d.error ?? "")) throw new Error(d.error);
        await new Promise((res) => setTimeout(res, 1500));
      }
      throw new Error("Your seat is reserved onchain but the lobby didn't confirm it. Tap Join again.");
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy("");
    }
  }

  async function answer(choice: number) {
    if (!state || !me || !token) return;
    setPicked({ qi: state.qIndex, choice });
    try {
      const r = await fetch(`/api/battles/${code}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: me, token, qi: state.qIndex, choice }),
      });
      if (!r.ok) {
        const d = await readRes(r);
        setErr(d.error ?? "That answer didn't go through.");
      }
      refresh();
    } catch (e) {
      setErr(friendlyError(e));
    }
  }

  useEffect(() => setErr(""), [state?.qIndex, state?.phase]);

  if (error && !state)
    return (
      <>
        <Header />
        <main className="wrap pad stack">
          <h2>Battle {code}</h2>
          <p className="error">{error}</p>
          <Link className="btn ghost" href="/">Try another code</Link>
        </main>
      </>
    );
  if (!state?.chain) return <><Header /><main className="wrap pad"><p className="muted">Loading battle {code}…</p></main></>;

  const chain = state.chain;
  const q = state.question;
  const myAnswer = state.myAnswer ?? (picked?.qi === state.qIndex ? { choice: picked.choice } : undefined);
  const myStanding = state.board.find((s) => s.wallet === me);
  const joinClosed = Date.now() / 1000 > chain.joinDeadline;

  return (
    <div className="paper">
      <Header />
      <main className="wrap pad">
        {state.phase === "lobby" && (
          <div className="grid-2">
            <div className="stack" style={{ ["--stack" as string]: "20px" }}>
              <div>
                <p className="muted">{state.sponsorName} presents</p>
                <h2>{state.title}</h2>
              </div>
              <div className="pot">
                <p className="small" style={{ fontWeight: 700 }}>Prize locked onchain</p>
                <p className="pot-amount">{money(chain.prizeAmount, chain.decimals)}</p>
                <p className="small mt-1">
                  {chain.payoutBps.map((_, i) => `${["1st", "2nd", "3rd"][i]} ${fromBase(prizeFor(chain, i) ?? 0n, chain.decimals)}`).join(" · ")}
                </p>
              </div>

              {joined ? (
                <div className="notice">
                  <strong>You&apos;re in.</strong> Keep this page open. Questions appear here the moment the host starts.
                </div>
              ) : isOrganizer ? (
                <div className="notice">
                  This wallet is running the battle, so it can&apos;t play. <Link href={`/host/${code}`}>Go to the host stage</Link> or join from another wallet.
                </div>
              ) : joinClosed ? (
                <p className="notice">Joining has closed for this battle.</p>
              ) : !wallet.publicKey ? (
                <div className="stack">
                  <p>Connect a Solana wallet to take a seat. Joining is free; you only pay a tiny devnet fee.</p>
                  <WalletButton label="Connect wallet to join" block />
                </div>
              ) : (
                <div className="sheet stack">
                  <div className="sheet-head"><span>Candidate details</span><span>Seat {state.players.length + 1} of {chain.maxPlayers}</span></div>
                  <label className="field">
                    <span>Your name on the leaderboard</span>
                    <input className="input" value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="e.g. Chioma" />
                  </label>
                  {err && <p className="error">{err}</p>}
                  <button className="btn block" disabled={!!busy} onClick={join}>{busy || "Join battle"}</button>
                  <p className="hint">Joining writes your seat onchain, so only real players can be paid.</p>
                </div>
              )}
            </div>
            <div>
              <h3>{state.players.length} in the hall</h3>
              <div className="players mt-1">
                {state.players.map((p) => <span key={p.wallet} className="player-chip">{p.name}{p.wallet === me ? " (you)" : ""}</span>)}
              </div>
              <p className="hint mt-2">{state.total} questions · {state.secondsPerQuestion}s each · split {splitLabel(chain.payoutBps)}</p>
            </div>
          </div>
        )}

        {(state.phase === "question" || state.phase === "reveal") && q && (
          <div className="stack" style={{ ["--stack" as string]: "18px", maxWidth: 680 }}>
            <div className="spread">
              <span className="muted">Question {state.qIndex + 1} of {state.total}</span>
              {myStanding && <span className="muted">You: {myStanding.score.toLocaleString()} pts · #{myStanding.rank}</span>}
            </div>
            {state.phase === "question" ? (
              now() < state.qEndsAt - state.secondsPerQuestion * 1000 ? (
                <p className="muted">Get ready…</p>
              ) : (
                <Countdown endsAt={state.qEndsAt} total={state.secondsPerQuestion} now={now} />
              )
            ) : null}
            <h2 style={{ fontSize: "clamp(1.4rem,5vw,2rem)" }}>{q.q}</h2>
            <div className="opts-grid">
              {q.options.map((o, i) => {
                const reveal = state.phase === "reveal";
                const mine = myAnswer?.choice === i;
                const right = reveal && q.answer === i;
                const bubble = right ? "correct" : reveal && mine ? "wrong" : mine ? "shaded" : "empty";
                return (
                  <button
                    key={i}
                    className={`option ${mine ? "picked" : ""} ${right ? "is-correct" : ""} ${reveal && mine && !right ? "is-wrong" : ""}`}
                    disabled={!joined || reveal || !!myAnswer || now() < state.qEndsAt - state.secondsPerQuestion * 1000}
                    onClick={() => answer(i)}
                  >
                    <Bubble letter={LETTERS[i]} state={bubble} />
                    {o}
                    {reveal && <span className="count">{q.counts?.[i] ?? 0}</span>}
                  </button>
                );
              })}
            </div>
            {!joined && <p className="notice">You&apos;re watching. Join the next battle to play.</p>}
            {state.phase === "question" && myAnswer && <p className="muted">Answer locked. Waiting for the clock…</p>}
            {state.phase === "reveal" && joined && (
              <p className="notice">
                {state.myAnswer?.correct
                  ? `Correct. +${state.myAnswer.points} points.`
                  : state.myAnswer
                    ? "Not this one."
                    : "You didn't answer in time."}
                {q.explain ? ` ${q.explain}` : ""}
              </p>
            )}
            {err && <p className="error">{err}</p>}
          </div>
        )}

        {state.phase === "finished" && (
          <div className="grid-2">
            <div className="stack" style={{ ["--stack" as string]: "20px" }}>
              <h2>{state.title}: results</h2>
              {myStanding && (() => {
                const won = state.winners?.includes(me!) ?? (myStanding.rank <= chain.payoutBps.length && myStanding.score > 0);
                const p = won ? prizeFor(chain, myStanding.rank - 1) : null;
                return (
                  <div className={won ? "pot" : "notice"}>
                    <strong>You finished #{myStanding.rank} with {myStanding.score.toLocaleString()} points.</strong>
                    {won && p !== null && (
                      <p className="mt-1">
                        {state.settleTx ? (
                          <>{fromBase(p, chain.decimals)} {PRIZE_SYMBOL} is in your wallet. <a href={explorerTx(state.settleTx)} target="_blank" rel="noreferrer">See the transaction</a>.</>
                        ) : (
                          <>You won {fromBase(p, chain.decimals)} {PRIZE_SYMBOL}. It lands in your wallet as soon as the host pays out.</>
                        )}
                      </p>
                    )}
                  </div>
                );
              })()}
              <Podium board={state.board} chain={chain} />
              <div>
                <h3>Scoreboard</h3>
                <Leaderboard board={state.board} me={me} limit={50} />
              </div>
            </div>
            <div className="sheet">
              <VerifyPanel chain={chain} quizCommit={state.quizCommit} revealedQuiz={state.revealedQuiz} resultsHash={state.resultsHash} settleTx={state.settleTx} />
            </div>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
