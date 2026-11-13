"use client";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Bubble, Footer, Header, LETTERS } from "@/components/ui";
import WalletButton from "@/components/WalletButton";
import { createBattleIx, newBattleId } from "@/lib/geeclass";
import type { ChainInfo, QuizQuestion } from "@/lib/game";
import { PRIZE_DECIMALS, PRIZE_MINT, PRIZE_SYMBOL, fromBase, splitLabel, toBase } from "@/lib/format";
import { friendlyError, sendIxs } from "@/lib/tx";

type Step = 1 | 2 | 3;

const SPLITS: { label: string; bps: number[] }[] = [
  { label: "Top 3: 50 / 30 / 20", bps: [5000, 3000, 2000] },
  { label: "Top 2: 60 / 40", bps: [6000, 4000] },
  { label: "Winner takes all", bps: [10000] },
];

const JOIN_WINDOWS = [
  { label: "15 minutes", mins: 15 },
  { label: "1 hour", mins: 60 },
  { label: "1 day", mins: 1440 },
  { label: "1 week", mins: 10080 },
];

const SAMPLE_NOTES = `A control system manages the behaviour of other devices or systems using control loops. In an open-loop control system, the control action does not depend on the output; a toaster that runs for a fixed time is a common example. In a closed-loop control system, also called a feedback control system, the measured output is fed back and compared with the reference input to produce an error signal. The controller acts on this error signal to reduce the difference between the desired and actual output.

A PID controller combines three terms. The proportional term produces an output proportional to the current error. The integral term accumulates past error and removes steady-state error. The derivative term predicts future error from its rate of change and adds damping, which reduces overshoot.

The transfer function of a linear time-invariant system is the ratio of the Laplace transform of the output to the Laplace transform of the input, assuming zero initial conditions. The poles of the transfer function determine stability: a continuous-time system is stable when all poles lie in the left half of the s-plane. A sensor converts a physical quantity into a signal, while an actuator converts a control signal into physical action, such as a motor turning or a valve opening.

Mechatronics combines mechanical engineering, electronics, computer engineering and control engineering. A stepper motor moves in discrete steps, which makes it useful for precise positioning in printers and CNC machines. A servo motor uses feedback from an encoder or potentiometer to hold an exact position.`;

export default function HostNew() {
  const router = useRouter();
  const { connection } = useConnection();
  const wallet = useWallet();

  const [step, setStep] = useState<Step>(1);
  const [title, setTitle] = useState("");
  const [sponsorName, setSponsorName] = useState("");
  const [notes, setNotes] = useState("");
  const [count, setCount] = useState(8);
  const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard">("medium");
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [source, setSource] = useState("");
  const [seconds, setSeconds] = useState(20);
  const [prize, setPrize] = useState("10");
  const [split, setSplit] = useState(0);
  const [maxPlayers, setMaxPlayers] = useState(50);
  const [joinMins, setJoinMins] = useState(60);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [balance, setBalance] = useState<bigint | null>(null);

  useEffect(() => {
    if (!wallet.publicKey || !PRIZE_MINT) return setBalance(null);
    const ata = getAssociatedTokenAddressSync(new PublicKey(PRIZE_MINT), wallet.publicKey);
    getAccount(connection, ata)
      .then((a) => setBalance(a.amount))
      .catch(() => setBalance(0n));
  }, [wallet.publicKey, connection, step]);

  async function readFile(file: File) {
    if (file.size > 2_000_000) return setError("That file is over 2 MB. Paste the key sections instead.");
    if (!/\.(txt|md|csv)$/i.test(file.name) && !file.type.startsWith("text/"))
      return setError("Upload a .txt or .md file, or copy text from your PDF and paste it in.");
    setNotes((await file.text()).slice(0, 40_000));
  }

  async function generate() {
    setError("");
    setBusy("Reading your notes and writing questions…");
    try {
      const res = await fetch("/api/quiz/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: notes, count, difficulty }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setQuestions(data.questions);
      setSource(data.source);
      setStep(2);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy("");
    }
  }

  function updateQ(i: number, patch: Partial<QuizQuestion>) {
    setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  }

  async function lockAndCreate() {
    setError("");
    if (!wallet.publicKey) return setError("Connect the wallet that holds the prize.");
    if (!PRIZE_MINT) return setError("This server has no prize token configured (NEXT_PUBLIC_PRIZE_MINT).");
    let amount: bigint;
    try {
      amount = toBase(prize, PRIZE_DECIMALS);
    } catch (e) {
      return setError(friendlyError(e));
    }
    if (amount <= 0n) return setError("Set a prize above zero.");
    if (balance !== null && amount > balance)
      return setError(`You have ${fromBase(balance)} ${PRIZE_SYMBOL}. Lower the prize or top up on the Faucet page.`);

    try {
      setBusy("Saving your quiz…");
      const draft = await fetch("/api/battles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, sponsorName, questions, secondsPerQuestion: seconds }),
      }).then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        return d as { code: string; hostKey: string; quizCommit: string };
      });
      localStorage.setItem(`geeclass:host:${draft.code}`, draft.hostKey);

      setBusy("Approve in your wallet to lock the prize…");
      const now = Math.floor(Date.now() / 1000);
      const joinDeadline = now + joinMins * 60;
      const settleDeadline = joinDeadline + 7 * 24 * 3600; // a week to pay out, then sponsor can reclaim
      const battleId = newBattleId();
      const mint = new PublicKey(PRIZE_MINT);
      const bps = SPLITS[split].bps;
      const commit = Uint8Array.from(draft.quizCommit.match(/../g)!.map((h) => parseInt(h, 16)));
      const { ix, battle } = createBattleIx({
        sponsor: wallet.publicKey,
        host: wallet.publicKey,
        mint,
        battleId,
        title: title.slice(0, 64),
        prizeAmount: amount,
        payoutBps: bps,
        maxPlayers,
        joinDeadline,
        settleDeadline,
        quizCommit: commit,
      });
      const sig = await sendIxs(connection, wallet, [ix]);

      setBusy("Prize locked. Opening the lobby…");
      const chain: ChainInfo = {
        battle: battle.toBase58(),
        battleId: battleId.toString(),
        mint: mint.toBase58(),
        sponsor: wallet.publicKey.toBase58(),
        host: wallet.publicKey.toBase58(),
        prizeAmount: amount.toString(),
        decimals: PRIZE_DECIMALS,
        payoutBps: bps,
        maxPlayers,
        joinDeadline,
        settleDeadline,
        createTx: sig,
      };
      for (let i = 0; i < 6; i++) {
        const r = await fetch(`/api/battles/${draft.code}/activate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hostKey: draft.hostKey, chain }),
        });
        if (r.ok) return router.push(`/host/${draft.code}`);
        if (r.status !== 409 && r.status !== 502) throw new Error((await r.json()).error);
        await new Promise((res) => setTimeout(res, 2000));
      }
      throw new Error("The prize is locked, but the lobby didn't open. Refresh this page in a minute.");
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy("");
    }
  }

  const stepLabels = ["Material", "Questions", "Prize"];

  return (
    <>
      <Header />
      <main className="wrap pad">
        <h2>Host a battle</h2>
        <div className="steps" aria-label="Progress">
          {stepLabels.map((l, i) => (
            <span key={l} className="row" style={{ gap: 6 }}>
              <Bubble letter={String(i + 1)} state={step > i + 1 ? "correct" : step === i + 1 ? "shaded" : "empty"} size={32} />
              <span className="step-label">{l}</span>
            </span>
          ))}
        </div>

        {step === 1 && (
          <div className="sheet stack">
            <div className="sheet-head">
              <span>Course material</span>
              <button className="linkish" style={{ color: "inherit" }} onClick={() => { setNotes(SAMPLE_NOTES); if (!title) setTitle("MCE 307 Control Systems Revision"); }}>
                Use sample notes
              </button>
            </div>
            <label className="field">
              <span>Battle title</span>
              <input className="input" value={title} maxLength={64} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. MTH 201 Mid-semester Warm-up" />
            </label>
            <label className="field">
              <span>Sponsored by</span>
              <input className="input" value={sponsorName} maxLength={48} onChange={(e) => setSponsorName(e.target.value)} placeholder="Your name, department or brand" />
            </label>
            <label className="field">
              <span>Notes, slides text or past questions</span>
              <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Paste anything from the course. The more you paste, the better the questions." />
              <div className="hint spread">
                <span>{notes.length.toLocaleString()} characters</span>
                <label className="linkish">
                  Upload a .txt file
                  <input type="file" accept=".txt,.md,text/plain" className="sr" onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} />
                </label>
              </div>
            </label>
            <div className="row">
              <label className="field">
                <span>Questions</span>
                <select className="input" value={count} onChange={(e) => setCount(Number(e.target.value))}>
                  {[5, 8, 10, 12, 15].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <div className="field">
                <span style={{ display: "block", fontWeight: 600, fontSize: "0.92rem", marginBottom: 6 }}>Difficulty</span>
                <div className="seg" role="group" aria-label="Difficulty">
                  {(["easy", "medium", "hard"] as const).map((d) => (
                    <button key={d} aria-pressed={difficulty === d} onClick={() => setDifficulty(d)}>{d[0].toUpperCase() + d.slice(1)}</button>
                  ))}
                </div>
              </div>
            </div>
            {error && <p className="error">{error}</p>}
            <button className="btn block" disabled={!!busy || !title.trim() || notes.trim().length < 200} onClick={generate}>
              {busy || "Write the questions"}
            </button>
            {notes.trim().length > 0 && notes.trim().length < 200 && <p className="hint">Paste at least 200 characters.</p>}
          </div>
        )}

        {step === 2 && (
          <div className="stack">
            <div className="spread">
              <p className="muted">
                {questions.length} questions{source === "offline" ? " from the built-in generator" : ` written by AI (${source})`}. Tap a bubble to change the right answer.
              </p>
              <button className="linkish" onClick={() => setStep(1)}>Back to material</button>
            </div>
            {questions.map((q, i) => (
              <div className="qcard" key={i}>
                <div className="spread">
                  <strong>Question {i + 1}</strong>
                  <button className="linkish small" onClick={() => setQuestions((qs) => qs.filter((_, j) => j !== i))} disabled={questions.length <= 3}>
                    Remove
                  </button>
                </div>
                <textarea className="input mt-1" rows={2} value={q.q} onChange={(e) => updateQ(i, { q: e.target.value })} aria-label={`Question ${i + 1}`} />
                <div className="qcard-opts">
                  {q.options.map((o, k) => (
                    <div className="qcard-opt" key={k}>
                      <button className="linkish" style={{ textDecoration: "none" }} onClick={() => updateQ(i, { answer: k })} aria-label={`Mark ${LETTERS[k]} correct`}>
                        <Bubble letter={LETTERS[k]} state={q.answer === k ? "correct" : "empty"} size={34} />
                      </button>
                      <input
                        className="input"
                        value={o}
                        onChange={(e) => updateQ(i, { options: q.options.map((x, j) => (j === k ? e.target.value : x)) })}
                        aria-label={`Option ${LETTERS[k]}`}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div className="row">
              <label className="field">
                <span>Seconds per question</span>
                <select className="input" value={seconds} onChange={(e) => setSeconds(Number(e.target.value))}>
                  {[10, 15, 20, 30, 45].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>
            <button className="btn block" disabled={questions.length < 3 || questions.some((q) => !q.q.trim() || q.options.some((o) => !o.trim()))} onClick={() => setStep(3)}>
              Set the prize
            </button>
          </div>
        )}

        {step === 3 && (
          <div className="grid-2">
            <div className="sheet stack">
              <div className="sheet-head"><span>Prize pool</span><span>{PRIZE_SYMBOL} on Solana devnet</span></div>
              <label className="field">
                <span>Total prize ({PRIZE_SYMBOL})</span>
                <input className="input" inputMode="decimal" value={prize} onChange={(e) => setPrize(e.target.value)} />
                {wallet.publicKey && balance !== null && (
                  <span className="hint">
                    You have {fromBase(balance)} {PRIZE_SYMBOL}. {balance === 0n && <Link href="/faucet">Get free test {PRIZE_SYMBOL}</Link>}
                  </span>
                )}
              </label>
              <label className="field">
                <span>How the prize is split</span>
                <select className="input" value={split} onChange={(e) => setSplit(Number(e.target.value))}>
                  {SPLITS.map((s, i) => <option key={s.label} value={i}>{s.label}</option>)}
                </select>
              </label>
              <div className="row">
                <label className="field" style={{ flex: 1 }}>
                  <span>Max players</span>
                  <input className="input" type="number" min={2} max={500} value={maxPlayers} onChange={(e) => setMaxPlayers(Math.max(2, Math.min(500, Number(e.target.value) || 2)))} />
                </label>
                <label className="field" style={{ flex: 1 }}>
                  <span>Joining closes in</span>
                  <select className="input" value={joinMins} onChange={(e) => setJoinMins(Number(e.target.value))}>
                    {JOIN_WINDOWS.map((w) => <option key={w.mins} value={w.mins}>{w.label}</option>)}
                  </select>
                </label>
              </div>
              {error && <p className="error">{error}</p>}
              {wallet.publicKey ? (
                <button className="btn money block" disabled={!!busy} onClick={lockAndCreate}>
                  {busy || `Lock ${prize || 0} ${PRIZE_SYMBOL} and open the lobby`}
                </button>
              ) : (
                <WalletButton label="Connect wallet to fund" block />
              )}
              <button className="linkish" onClick={() => setStep(2)}>Back to questions</button>
            </div>
            <div className="stack">
              <div className="pot">
                <p className="small" style={{ fontWeight: 700 }}>{title || "Your battle"}</p>
                <p className="pot-amount">{prize || 0} {PRIZE_SYMBOL}</p>
                <div className="split-preview mt-1">
                  {SPLITS[split].bps.map((b, i) => (
                    <span className="split-chip" key={i} style={{ background: "rgba(255,255,255,0.6)" }}>
                      {["1st", "2nd", "3rd"][i]}: {(() => { try { return fromBase((toBase(prize || "0") * BigInt(b)) / 10000n); } catch { return "0"; } })()}
                    </span>
                  ))}
                </div>
              </div>
              <div className="notice">
                <strong>What happens to the money</strong>
                <p className="mt-1 small">
                  It moves into a vault owned by the GeeClass program, not a person. It can only leave two ways: to the
                  top {SPLITS[split].bps.length === 1 ? "player" : `${SPLITS[split].bps.length} players`} ({splitLabel(SPLITS[split].bps)}) when you pay out, or back to you
                  if nobody joins or you don&apos;t pay out within a week of joining closing. Unfilled places return to you.
                </p>
              </div>
              <p className="hint">You host the battle from this wallet. Hosts and sponsors can&apos;t play in their own battle.</p>
            </div>
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
