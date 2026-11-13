// What the voice host says at each moment of a battle.
// Light Naija-campus flavour; never mean about anyone's ability beyond friendly banter.

import type { PublicState } from "./game";

const pick = <T,>(arr: T[], seed: number) => arr[Math.abs(seed) % arr.length];

export function lobbyLine(s: PublicState) {
  return `Welcome to ${s.title}. ${s.players.length} players in the hall. Pens down, phones up, it's about to start.`;
}

/** Turns on-screen text into something a voice can read naturally. */
export function speakable(t: string) {
  return t
    .replace(/^Fill the gap:\s*"?/i, "Fill in the blank. ")
    .replace(/_{2,}/g, " blank ")
    .replace(/["“”]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function questionLine(s: PublicState) {
  if (!s.question) return "";
  const n = s.qIndex + 1;
  const lead =
    n === s.total
      ? "Final question. Everything rides on this one."
      : pick(
          [
            `Question ${n}.`,
            `Oya, question ${n}.`,
            `Question ${n} of ${s.total}. Lock in.`,
            `Here comes question ${n}.`,
          ],
          n,
        );
  const opts = s.question.options.map((o, i) => `${"ABCD"[i]}: ${speakable(o)}`).join(". ");
  return `${lead} ${speakable(s.question.q)} ${opts}.`;
}

export function revealLine(s: PublicState) {
  const q = s.question;
  if (!q || q.answer === undefined) return "";
  const right = q.counts?.[q.answer] ?? 0;
  const total = (q.counts ?? []).reduce((a, b) => a + b, 0);
  const answer = `The answer is ${"ABCD"[q.answer]}, ${speakable(q.options[q.answer])}.`;
  const leader = s.board[0];

  let mood: string;
  if (total === 0) mood = "Nobody answered? The hall is quiet o.";
  else if (right === total) mood = "Everybody got it. This class is cracked.";
  else if (right === 0) mood = "Not one person got it. Who taught you people?";
  else if (right / total < 0.35) mood = `Only ${right} of ${total} got that one. Somebody didn't read.`;
  else mood = `${right} of ${total} got it right.`;

  const lead = leader && leader.score > 0 ? ` ${leader.name} is on top with ${leader.score} points.` : "";
  return `${answer} ${mood}${lead}`;
}

export function finishLine(s: PublicState) {
  const [a, b, c] = s.board;
  if (!a || a.score === 0) return "That's the end of the battle. Tough one. The prize goes back to the sponsor.";
  let line = `That's a wrap! ${a.name} takes first place with ${a.score} points.`;
  if (b && b.score > 0) line += ` ${b.name} comes second.`;
  if (c && c.score > 0) line += ` And ${c.name} is third.`;
  return `${line} Prize money is locked onchain and goes straight to the winners.`;
}
