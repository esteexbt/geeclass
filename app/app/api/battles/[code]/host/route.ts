import { PublicKey } from "@solana/web3.js";
import { fetchBattle } from "@/lib/geeclass";
import { canonicalResults, effectivePhase, leaderboard, pickWinners } from "@/lib/game";
import { connection, fail, isHost, loadBattle, ok, readJson, sha256Hex, skipChain } from "@/lib/server";
import { getStore } from "@/lib/store";

type Action = "start" | "next" | "plan" | "settled";

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const body = await readJson<{ hostKey?: string; action?: Action; tx?: string }>(req);
  const doc = await loadBattle(code);
  if (!doc?.chain) return fail("No funded battle with that code.", 404);
  if (!(await isHost(doc, body?.hostKey))) return fail("Only the host can do this.", 403);

  const store = getStore();
  const [players, answers] = await Promise.all([store.listPlayers(doc.code), store.listAnswers(doc.code)]);
  const now = Date.now();
  const phase = effectivePhase(doc, answers.filter((a) => a.qi === doc.qIndex).length, players.length, now);

  switch (body?.action) {
    case "start": {
      if (phase !== "lobby") return fail("Battle already started.", 409);
      if (players.length < 1) return fail("Wait for at least one player to join.", 409);
      doc.phase = "question";
      doc.qIndex = 0;
      doc.qStartedAt = now + 1500; // short beat so every phone sees the question at the same moment
      break;
    }
    case "next": {
      if (phase !== "reveal") return fail("Wait for this question to finish.", 409);
      if (doc.qIndex + 1 >= doc.quiz.questions.length) {
        doc.phase = "finished";
      } else {
        doc.phase = "question";
        doc.qIndex += 1;
        doc.qStartedAt = now + 1000;
      }
      break;
    }
    case "plan": {
      if (phase !== "finished") return fail("Finish the battle first.", 409);
      const board = leaderboard(players, answers);
      const winners = pickWinners(board, doc.chain.payoutBps.length);
      const resultsHash = await sha256Hex(canonicalResults(board));
      return ok({ winners, resultsHash });
    }
    case "settled": {
      if (phase !== "finished") return fail("Finish the battle first.", 409);
      const board = leaderboard(players, answers);
      const resultsHash = await sha256Hex(canonicalResults(board));
      if (!skipChain()) {
        const onchain = await fetchBattle(connection(), new PublicKey(doc.chain.battle));
        if (onchain?.status !== "settled") return fail("Payout isn't confirmed onchain yet. Retry in a few seconds.", 409);
        if (onchain.resultsHash !== resultsHash) return fail("Onchain results don't match this scoreboard.", 409);
        doc.winners = onchain.winners;
      } else {
        doc.winners = pickWinners(board, doc.chain.payoutBps.length).map((w) => w.wallet);
      }
      doc.settleTx = typeof body.tx === "string" ? body.tx : undefined;
      doc.resultsHash = resultsHash;
      break;
    }
    default:
      return fail("Unknown action.");
  }
  await store.saveBattle(doc);
  return ok({ phase: doc.phase });
}
