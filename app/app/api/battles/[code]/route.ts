import { publicState } from "@/lib/game";
import { fail, isHost, loadBattle, ok } from "@/lib/server";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const doc = await loadBattle(code);
  if (!doc) return fail("No battle with that code.", 404);
  const url = new URL(req.url);
  const hostKey = url.searchParams.get("hostKey");
  const host = await isHost(doc, hostKey);
  if (!doc.chain && !host) return fail("This battle hasn't been funded yet.", 404);

  const store = getStore();
  const [players, answers] = await Promise.all([store.listPlayers(doc.code), store.listAnswers(doc.code)]);
  const state = publicState(doc, players, answers, Date.now(), url.searchParams.get("wallet") ?? undefined);
  return ok(host ? { ...state, isHost: true, draftQuiz: doc.chain ? undefined : doc.quiz.questions } : state);
}
