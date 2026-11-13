import { canonicalQuiz, newCode, newSecret, type BattleDoc, type QuizQuestion } from "@/lib/game";
import { fail, ok, readJson, sha256Hex } from "@/lib/server";
import { getStore } from "@/lib/store";

// Step 1 of creating a battle: save the quiz and get the commitment the sponsor locks onchain.
export async function POST(req: Request) {
  const body = await readJson<{
    title?: string;
    sponsorName?: string;
    questions?: QuizQuestion[];
    secondsPerQuestion?: number;
  }>(req);
  const title = body?.title?.trim().slice(0, 64) ?? "";
  if (!title) return fail("Give the battle a title.");
  const questions = (body?.questions ?? []).filter(
    (q) => q && typeof q.q === "string" && q.options?.length === 4 && q.answer >= 0 && q.answer < 4,
  );
  if (questions.length < 3) return fail("A battle needs at least 3 questions.");
  if (questions.length > 20) return fail("Keep it to 20 questions or fewer.");

  const salt = newSecret(16);
  const quiz = { questions, salt };
  const hostKey = newSecret(24);
  const doc: BattleDoc = {
    code: newCode(),
    title,
    sponsorName: body?.sponsorName?.trim().slice(0, 48) || "Anonymous sponsor",
    createdAt: Date.now(),
    hostKeyHash: await sha256Hex(hostKey),
    quiz,
    quizCommit: await sha256Hex(canonicalQuiz(quiz)),
    secondsPerQuestion: Math.min(60, Math.max(10, Number(body?.secondsPerQuestion) || 20)),
    chain: null,
    phase: "lobby",
    qIndex: 0,
    qStartedAt: 0,
  };
  await getStore().createBattle(doc);
  return ok({ code: doc.code, hostKey, quizCommit: doc.quizCommit });
}
