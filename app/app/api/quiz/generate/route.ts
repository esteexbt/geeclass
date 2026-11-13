import { generateQuiz } from "@/lib/quiz";
import { fail, ok, readJson } from "@/lib/server";

export const maxDuration = 60;

export async function POST(req: Request) {
  const body = await readJson<{ text?: string; count?: number; difficulty?: string }>(req);
  const text = body?.text?.trim() ?? "";
  if (text.length < 200) return fail("Paste at least a few paragraphs of course material (200+ characters).");
  const count = Math.min(15, Math.max(3, Number(body?.count) || 8));
  const difficulty = (["easy", "medium", "hard"].includes(body?.difficulty ?? "") ? body!.difficulty : "medium") as
    | "easy"
    | "medium"
    | "hard";
  try {
    return ok(await generateQuiz({ text, count, difficulty }));
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not build questions from that material.", 422);
  }
}
