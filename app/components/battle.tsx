"use client";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useEffect, useState } from "react";
import { canonicalQuiz, type ChainInfo, type Quiz, type Standing } from "@/lib/game";
import { fetchBattle, hex, sha256, type OnchainBattle } from "@/lib/geeclass";
import { explorerAddr, explorerTx, fromBase, PRIZE_SYMBOL, short } from "@/lib/format";
import { useTicker } from "@/lib/useBattle";

export function Countdown({ endsAt, total, now }: { endsAt: number; total: number; now: () => number }) {
  useTicker(true, 100);
  const left = Math.max(0, endsAt - now());
  const frac = Math.min(1, left / (total * 1000));
  return (
    <div className="row" style={{ gap: 14, flexWrap: "nowrap" }}>
      <div className="timer" style={{ flex: 1 }} role="progressbar" aria-valuenow={Math.ceil(left / 1000)} aria-valuemin={0} aria-valuemax={total} aria-label="Time left">
        <div style={{ transform: `scaleX(${frac})` }} />
      </div>
      <span className="secs" aria-hidden>{Math.ceil(left / 1000)}</span>
    </div>
  );
}

export function Leaderboard({ board, me, limit = 10 }: { board: Standing[]; me?: string; limit?: number }) {
  if (board.length === 0) return <p className="muted">No scores yet.</p>;
  return (
    <ol className="board">
      {board.slice(0, limit).map((s) => (
        <li key={s.wallet} className={s.wallet === me ? "me" : ""}>
          <span className="rank">{s.rank}</span>
          <span>
            <strong>{s.name}</strong>
            <span className="muted small"> · {s.correct} right</span>
          </span>
          <span className="score">{s.score.toLocaleString()}</span>
        </li>
      ))}
    </ol>
  );
}

export function prizeFor(chain: ChainInfo, place: number) {
  const bps = chain.payoutBps[place];
  if (!bps) return null;
  return (BigInt(chain.prizeAmount) * BigInt(bps)) / 10000n;
}

export function Podium({ board, chain }: { board: Standing[]; chain: ChainInfo }) {
  const winners = board.filter((s) => s.score > 0).slice(0, chain.payoutBps.length);
  if (winners.length === 0)
    return <p className="muted">Nobody scored, so the full prize goes back to the sponsor.</p>;
  return (
    <div className="podium">
      {winners.map((w, i) => {
        const p = prizeFor(chain, i);
        return (
          <div key={w.wallet} className={`podium-row ${i === 0 ? "first" : ""}`}>
            <span className="place">{["1st", "2nd", "3rd"][i]}</span>
            <span>
              <strong>{w.name}</strong>
              <br />
              <span className="small">{w.score.toLocaleString()} pts · {short(w.wallet)}</span>
            </span>
            <span className="prize">{p !== null ? `${fromBase(p)} ${PRIZE_SYMBOL}` : ""}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Lets anyone check the battle wasn't rigged, using only the chain and the revealed quiz. */
export function VerifyPanel({
  chain,
  quizCommit,
  revealedQuiz,
  resultsHash,
  settleTx,
}: {
  chain: ChainInfo;
  quizCommit: string;
  revealedQuiz?: Quiz;
  resultsHash?: string;
  settleTx?: string;
}) {
  const { connection } = useConnection();
  const [onchain, setOnchain] = useState<OnchainBattle | null>(null);
  const [computed, setComputed] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    fetchBattle(connection, new PublicKey(chain.battle))
      .then(setOnchain)
      .catch(() => setErr("Couldn't reach Solana to double-check right now. The links above still work."));
  }, [connection, chain.battle, settleTx]);

  useEffect(() => {
    if (revealedQuiz) sha256(canonicalQuiz(revealedQuiz)).then((b) => setComputed(hex(b)));
  }, [revealedQuiz]);

  const quizOk = onchain && computed && onchain.quizCommit === computed;

  return (
    <div className="verify stack" style={{ ["--stack" as string]: "10px" }}>
      <h3>Check it yourself</h3>
      <p>
        Battle account: <a href={explorerAddr(chain.battle)} target="_blank" rel="noreferrer"><code>{short(chain.battle, 6)}</code></a>
        {" · "}
        <a href={explorerTx(chain.createTx)} target="_blank" rel="noreferrer">funding transaction</a>
      </p>
      <p>
        Quiz fingerprint locked onchain before the battle: <code>{onchain?.quizCommit ?? quizCommit}</code>
      </p>
      {revealedQuiz ? (
        <p>
          Fingerprint of the questions actually used: <code>{computed || "…"}</code>{" "}
          {quizOk ? <span className="ok-mark">Match</span> : onchain && computed ? <span className="error">Mismatch</span> : null}
        </p>
      ) : (
        <p className="muted">The full quiz and answer key are revealed here when the battle ends, so you can recheck the fingerprint.</p>
      )}
      {onchain && (
        <p>
          Onchain status: <strong>{onchain.status}</strong> · {onchain.playerCount} players joined onchain
        </p>
      )}
      {resultsHash && (
        <p>
          Scoreboard fingerprint posted at payout: <code>{resultsHash}</code>{" "}
          {onchain?.resultsHash === resultsHash && <span className="ok-mark">Match</span>}
        </p>
      )}
      {settleTx && (
        <p>
          <a href={explorerTx(settleTx)} target="_blank" rel="noreferrer">See the payout transaction on Solana Explorer</a>
        </p>
      )}
      {err && <p className="error small">{err}</p>}
    </div>
  );
}
