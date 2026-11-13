"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicState, QuizQuestion } from "./game";
import { readRes } from "./http";

export type BattleView = PublicState & { isHost?: boolean; draftQuiz?: QuizQuestion[] };

/** Polls the battle state. Faster while a question is live. */
export function useBattle(code: string, opts: { wallet?: string; hostKey?: string } = {}) {
  const [state, setState] = useState<BattleView | null>(null);
  const [error, setError] = useState("");
  const [skew, setSkew] = useState(0); // server clock minus local clock
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phaseRef = useRef<string>("lobby");

  const load = useCallback(async () => {
    const qs = new URLSearchParams();
    if (opts.wallet) qs.set("wallet", opts.wallet);
    if (opts.hostKey) qs.set("hostKey", opts.hostKey);
    try {
      const t0 = Date.now();
      const res = await fetch(`/api/battles/${code}?${qs}`, { cache: "no-store" });
      const data = await readRes<BattleView & { serverNow: number }>(res);
      if (!res.ok) throw new Error(data.error || "Couldn't load battle");
      const t1 = Date.now();
      setSkew(data.serverNow - (t0 + t1) / 2);
      phaseRef.current = data.phase;
      setState(data);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [code, opts.wallet, opts.hostKey]);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      await load();
      if (!alive) return;
      const p = phaseRef.current;
      timer.current = setTimeout(tick, p === "question" ? 700 : p === "finished" ? 4000 : 1300);
    };
    tick();
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  return { state, error, refresh: load, now: () => Date.now() + skew };
}

/** Re-renders every animation frame-ish (for countdowns). */
export function useTicker(active: boolean, ms = 100) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(id);
  }, [active, ms]);
}
