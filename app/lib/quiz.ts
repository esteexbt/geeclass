// Turns course material into multiple-choice questions.
// Uses whichever AI key is configured; with none, falls back to an offline generator
// so the app always works (no key needed for a demo).

import type { QuizQuestion } from "./game";

export interface GenerateOptions {
  text: string;
  count: number;
  difficulty: "easy" | "medium" | "hard";
}

export interface GenerateResult {
  questions: QuizQuestion[];
  source: "gemini" | "openai" | "anthropic" | "offline";
}

const MAX_INPUT = 24_000;

function prompt({ text, count, difficulty }: GenerateOptions) {
  return `You write exam-style multiple-choice questions for university students.
Write exactly ${count} ${difficulty} questions that test understanding of the COURSE MATERIAL below.
Rules:
- Use only facts found in the material. Never invent facts.
- Each question has exactly 4 options and exactly one correct answer.
- Wrong options must be plausible to a student who skimmed the material.
- Keep questions under 140 characters and options under 70 characters.
- "explain" is one short sentence saying why the answer is right.
Reply with JSON only, shaped like:
{"questions":[{"q":"...","options":["...","...","...","..."],"answer":0,"explain":"..."}]}

COURSE MATERIAL:
"""
${text.slice(0, MAX_INPUT)}
"""`;
}

function extractJson(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("No JSON in model reply");
  return JSON.parse(raw.slice(start, end + 1));
}

export function cleanQuestions(input: unknown, count: number): QuizQuestion[] {
  const list = (input as { questions?: unknown[] })?.questions;
  if (!Array.isArray(list)) throw new Error("Model reply had no questions");
  const out: QuizQuestion[] = [];
  for (const item of list) {
    const x = item as Partial<QuizQuestion>;
    if (typeof x.q !== "string" || !Array.isArray(x.options) || x.options.length !== 4) continue;
    const options = x.options.map((o) => String(o).trim().slice(0, 120));
    const answer = Number(x.answer);
    if (!Number.isInteger(answer) || answer < 0 || answer > 3) continue;
    if (new Set(options.map((o) => o.toLowerCase())).size !== 4) continue;
    out.push(shuffleOptions({ q: x.q.trim().slice(0, 240), options, answer, explain: x.explain?.toString().slice(0, 240) }));
    if (out.length === count) break;
  }
  if (out.length === 0) throw new Error("No usable questions in model reply");
  return out;
}

/** Models favour putting the answer first; reshuffle so position gives nothing away. */
export function shuffleOptions(q: QuizQuestion): QuizQuestion {
  const order = [0, 1, 2, 3];
  for (let i = order.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { ...q, options: order.map((i) => q.options[i]), answer: order.indexOf(q.answer) };
}

function randInt(n: number) {
  const b = new Uint32Array(1);
  globalThis.crypto.getRandomValues(b);
  return b[0] % n;
}

async function viaGemini(o: GenerateOptions, key: string) {
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt(o) }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.6 },
      }),
    },
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text as string;
}

async function viaOpenAI(o: GenerateOptions, key: string) {
  const base = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [{ role: "user", content: prompt(o) }],
      response_format: { type: "json_object" },
      temperature: 0.6,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content as string;
}

async function viaAnthropic(o: GenerateOptions, key: string) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-haiku-5-5",
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt(o) }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data?.content?.[0]?.text as string;
}

export async function generateQuiz(o: GenerateOptions): Promise<GenerateResult> {
  const tries: [GenerateResult["source"], string | undefined, typeof viaGemini][] = [
    ["gemini", process.env.GEMINI_API_KEY, viaGemini],
    ["openai", process.env.OPENAI_API_KEY, viaOpenAI],
    ["anthropic", process.env.ANTHROPIC_API_KEY, viaAnthropic],
  ];
  for (const [source, key, fn] of tries) {
    if (!key) continue;
    try {
      const raw = await fn(o, key);
      return { questions: cleanQuestions(extractJson(raw), o.count), source };
    } catch (e) {
      console.error(`[quiz] ${source} failed, trying next`, e);
    }
  }
  return { questions: offlineQuiz(o.text, o.count), source: "offline" };
}

// ---------- offline generator ----------
// Builds fill-in-the-gap questions from the material itself: picks sentences that
// contain a key term, blanks the term out, and uses other key terms as wrong options.

const STOP = new Set(
  "the a an and or but if of to in on at by for with from as is are was were be been being this that these those it its into than then which who whom whose what when where why how can could should would may might will shall do does did not no yes also such each other more most some any all both only own same so too very just over under between about after before during while there their they them we our you your he she his her him one two three".split(
    " ",
  ),
);

function sentences(text: string) {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 40 && s.length <= 260);
}

function keyTerms(text: string) {
  const counts = new Map<string, number>();
  const words = text.match(/[A-Za-z][A-Za-z\-']{3,}|\d+(?:\.\d+)?%?/g) ?? [];
  for (const w of words) {
    const k = w.toLowerCase();
    if (STOP.has(k)) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] * b[0].length - a[1] * a[0].length)
    .map(([w]) => w);
}

export function offlineQuiz(text: string, count: number): QuizQuestion[] {
  const terms = keyTerms(text);
  const pool = sentences(text);
  const used = new Set<string>();
  const out: QuizQuestion[] = [];

  for (const s of pool) {
    if (out.length >= count) break;
    const term = terms.find(
      (t) => !used.has(t.toLowerCase()) && new RegExp(`\\b${escapeRe(t)}\\b`).test(s),
    );
    if (!term) continue;
    const isNum = /^\d/.test(term);
    const distractors = terms
      .filter((t) => t.toLowerCase() !== term.toLowerCase() && /^\d/.test(t) === isNum && !s.includes(t))
      .slice(0, 12);
    if (distractors.length < 3) continue;
    const picks = pickN(distractors, 3);
    used.add(term.toLowerCase());
    out.push(
      shuffleOptions({
        q: `Fill the gap: "${s.replace(new RegExp(`\\b${escapeRe(term)}\\b`), "_____")}"`.slice(0, 240),
        options: [term, ...picks],
        answer: 0,
        explain: `From your notes: "${s.slice(0, 200)}"`,
      }),
    );
  }
  if (out.length === 0) throw new Error("Not enough material to build questions. Paste a longer passage.");
  return out;
}

function pickN<T>(arr: T[], n: number) {
  const copy = [...arr];
  const out: T[] = [];
  while (out.length < n && copy.length) out.push(copy.splice(randInt(copy.length), 1)[0]);
  return out;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
