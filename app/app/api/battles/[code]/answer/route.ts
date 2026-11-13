import { effectivePhase, scoreAnswer } from "@/lib/game";
import { fail, loadBattle, ok, readJson } from "@/lib/server";
import { getStore } from "@/lib/store";

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const now = Date.now();
  const { code } = await params;
  const body = await readJson<{ wallet?: string; token?: string; qi?: number; choice?: number }>(req);
  const doc = await loadBattle(code);
  if (!doc?.chain) return fail("No battle with that code.", 404);

  const store = getStore();
  const players = await store.listPlayers(doc.code);
  const me = players.find((p) => p.wallet === body?.wallet && p.token === body?.token);
  if (!me) return fail("You're not in this battle.", 403);

  const answers = await store.listAnswers(doc.code);
  const thisQ = answers.filter((a) => a.qi === doc.qIndex).length;
  if (body?.qi !== doc.qIndex || effectivePhase(doc, thisQ, players.length, now) !== "question") {
    return fail("Time's up for that question.", 409);
  }
  const choice = Number(body.choice);
  if (!Number.isInteger(choice) || choice < 0 || choice > 3) return fail("Pick A, B, C or D.");

  const q = doc.quiz.questions[doc.qIndex];
  const ms = Math.max(0, now - doc.qStartedAt);
  const correct = choice === q.answer;
  const saved = await store.addAnswer(doc.code, {
    wallet: me.wallet,
    qi: doc.qIndex,
    choice,
    ms,
    correct,
    points: scoreAnswer(correct, ms, doc.secondsPerQuestion * 1000),
  });
  if (!saved) return fail("You already answered this one.", 409);
  return ok({ locked: true });
}
