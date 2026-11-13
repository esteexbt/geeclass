// Pure game rules: scoring, phases, leaderboard, and what each viewer is allowed to see.

export interface QuizQuestion {
  q: string;
  options: string[]; // always 4
  answer: number; // index into options
  explain?: string;
}

export interface Quiz {
  questions: QuizQuestion[];
  salt: string;
}

export type Phase = "lobby" | "question" | "reveal" | "finished";

export interface ChainInfo {
  battle: string;
  battleId: string;
  mint: string;
  sponsor: string;
  host: string;
  prizeAmount: string; // base units
  decimals: number;
  payoutBps: number[];
  maxPlayers: number;
  joinDeadline: number;
  settleDeadline: number;
  createTx: string;
}

export interface BattleDoc {
  code: string;
  title: string;
  sponsorName: string;
  createdAt: number;
  hostKeyHash: string;
  quiz: Quiz;
  quizCommit: string; // hex sha256 of canonical quiz JSON
  secondsPerQuestion: number;
  chain: ChainInfo | null; // null until the sponsor funds the battle onchain
  phase: Phase;
  qIndex: number;
  qStartedAt: number;
  settleTx?: string;
  resultsHash?: string;
  winners?: string[];
}

export interface Player {
  wallet: string;
  name: string;
  token: string;
  joinedAt: number;
  joinTx?: string;
}

export interface Answer {
  wallet: string;
  qi: number;
  choice: number;
  ms: number;
  correct: boolean;
  points: number;
}

export const MAX_POINTS = 1000;

/** Correct answers earn 500 to 1000 points; faster answers earn more. */
export function scoreAnswer(correct: boolean, ms: number, durationMs: number) {
  if (!correct) return 0;
  const left = Math.max(0, Math.min(1, 1 - ms / durationMs));
  return Math.round(MAX_POINTS * (0.5 + 0.5 * left));
}

/** Canonical form the onchain quiz commitment is computed from. */
export function canonicalQuiz(quiz: Quiz) {
  return JSON.stringify({
    salt: quiz.salt,
    questions: quiz.questions.map((x) => ({ q: x.q, options: x.options, answer: x.answer })),
  });
}

export function effectivePhase(doc: BattleDoc, answersThisQ: number, players: number, now: number): Phase {
  if (doc.phase !== "question") return doc.phase;
  const timeUp = now >= doc.qStartedAt + doc.secondsPerQuestion * 1000;
  const allIn = players > 0 && answersThisQ >= players;
  return timeUp || allIn ? "reveal" : "question";
}

export interface Standing {
  rank: number;
  wallet: string;
  name: string;
  score: number;
  correct: number;
  totalMs: number;
}

/** Highest score wins; ties go to the faster total answer time, then whoever joined first. */
export function leaderboard(players: Player[], answers: Answer[]): Standing[] {
  const rows = players.map((p) => {
    const mine = answers.filter((a) => a.wallet === p.wallet);
    return {
      wallet: p.wallet,
      name: p.name,
      joinedAt: p.joinedAt,
      score: mine.reduce((s, a) => s + a.points, 0),
      correct: mine.filter((a) => a.correct).length,
      totalMs: mine.reduce((s, a) => s + a.ms, 0),
    };
  });
  rows.sort((a, b) => b.score - a.score || a.totalMs - b.totalMs || a.joinedAt - b.joinedAt);
  return rows.map((r, i) => ({ rank: i + 1, wallet: r.wallet, name: r.name, score: r.score, correct: r.correct, totalMs: r.totalMs }));
}

/** Winners are the top scorers who got at least one answer right, up to the number of prize places. */
export function pickWinners(board: Standing[], places: number) {
  return board.filter((s) => s.score > 0).slice(0, places);
}

export function canonicalResults(board: Standing[]) {
  return JSON.stringify(board.map((s) => [s.rank, s.wallet, s.score, s.correct, s.totalMs]));
}

export interface PublicQuestion {
  index: number;
  q: string;
  options: string[];
  answer?: number;
  explain?: string;
  counts?: number[];
}

export interface PublicState {
  code: string;
  title: string;
  sponsorName: string;
  phase: Phase;
  qIndex: number;
  total: number;
  secondsPerQuestion: number;
  qEndsAt: number;
  serverNow: number;
  question: PublicQuestion | null;
  players: { wallet: string; name: string }[];
  answeredThisQ: number;
  board: Standing[];
  chain: ChainInfo | null;
  quizCommit: string;
  settleTx?: string;
  resultsHash?: string;
  winners?: string[];
  /** Revealed only once the battle is over, so anyone can check the commitment. */
  revealedQuiz?: Quiz;
  myAnswer?: { choice: number; correct?: boolean; points?: number };
}

export function publicState(
  doc: BattleDoc,
  players: Player[],
  answers: Answer[],
  now: number,
  viewer?: string,
): PublicState {
  const thisQ = answers.filter((a) => a.qi === doc.qIndex);
  const phase = effectivePhase(doc, thisQ.length, players.length, now);
  const raw = doc.quiz.questions[doc.qIndex];
  let question: PublicQuestion | null = null;

  if (raw && (phase === "question" || phase === "reveal")) {
    question = { index: doc.qIndex, q: raw.q, options: raw.options };
    if (phase === "reveal") {
      question.answer = raw.answer;
      question.explain = raw.explain;
      question.counts = raw.options.map((_, i) => thisQ.filter((a) => a.choice === i).length);
    }
  }

  const mine = viewer ? thisQ.find((a) => a.wallet === viewer) : undefined;
  const board = leaderboard(players, answers);

  return {
    code: doc.code,
    title: doc.title,
    sponsorName: doc.sponsorName,
    phase,
    qIndex: doc.qIndex,
    total: doc.quiz.questions.length,
    secondsPerQuestion: doc.secondsPerQuestion,
    qEndsAt: doc.qStartedAt + doc.secondsPerQuestion * 1000,
    serverNow: now,
    question,
    players: players.map((p) => ({ wallet: p.wallet, name: p.name })),
    answeredThisQ: thisQ.length,
    // Hide live standings during a question so nobody can game the timing.
    board: phase === "question" ? [] : board,
    chain: doc.chain,
    quizCommit: doc.quizCommit,
    settleTx: doc.settleTx,
    resultsHash: doc.resultsHash,
    winners: doc.winners,
    revealedQuiz: phase === "finished" ? doc.quiz : undefined,
    myAnswer: mine
      ? phase === "reveal"
        ? { choice: mine.choice, correct: mine.correct, points: mine.points }
        : { choice: mine.choice }
      : undefined,
  };
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function newCode(len = 6) {
  const b = new Uint8Array(len);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join("");
}

export function newSecret(bytes = 18) {
  const b = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
