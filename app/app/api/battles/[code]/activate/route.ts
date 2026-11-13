import { PublicKey } from "@solana/web3.js";
import { fetchBattle } from "@/lib/geeclass";
import type { ChainInfo } from "@/lib/game";
import { connection, fail, isHost, loadBattle, ok, readJson, skipChain } from "@/lib/server";
import { getStore } from "@/lib/store";

// Step 2: after the sponsor's funding transaction lands, check the chain and open the lobby.
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const body = await readJson<{ hostKey?: string; chain?: ChainInfo }>(req);
  const doc = await loadBattle(code);
  if (!doc) return fail("No battle with that code.", 404);
  if (!(await isHost(doc, body?.hostKey))) return fail("Only the host can do this.", 403);
  if (doc.chain) return ok({ code: doc.code });
  const chain = body?.chain;
  if (!chain?.battle) return fail("Missing battle address.");

  if (!skipChain()) {
    let onchain;
    try {
      onchain = await fetchBattle(connection(), new PublicKey(chain.battle));
    } catch (e) {
      return fail(`Couldn't read the battle on Solana: ${e instanceof Error ? e.message : e}`, 502);
    }
    if (!onchain) return fail("Battle account not found onchain yet. Wait a few seconds and retry.", 409);
    if (onchain.quizCommit !== doc.quizCommit) return fail("Onchain quiz commitment doesn't match this quiz.", 409);
    if (onchain.status !== "open") return fail("That battle is no longer open onchain.", 409);
    // Trust the chain, not the request.
    chain.sponsor = onchain.sponsor;
    chain.host = onchain.host;
    chain.mint = onchain.mint;
    chain.prizeAmount = onchain.prizeAmount;
    chain.payoutBps = onchain.payoutBps;
    chain.maxPlayers = onchain.maxPlayers;
    chain.joinDeadline = onchain.joinDeadline;
    chain.settleDeadline = onchain.settleDeadline;
  }
  doc.chain = chain;
  await getStore().saveBattle(doc);
  return ok({ code: doc.code });
}
