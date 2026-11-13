import { PublicKey } from "@solana/web3.js";
import { entryExists } from "@/lib/geeclass";
import { newSecret } from "@/lib/game";
import { connection, fail, loadBattle, ok, readJson, skipChain } from "@/lib/server";
import { getStore } from "@/lib/store";

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const body = await readJson<{ wallet?: string; name?: string; joinTx?: string }>(req);
  const doc = await loadBattle(code);
  if (!doc?.chain) return fail("No open battle with that code.", 404);
  if (doc.phase !== "lobby") return fail("This battle has already started.", 409);

  let wallet: PublicKey;
  try {
    wallet = new PublicKey(body?.wallet ?? "");
  } catch {
    return fail("Connect a wallet first.");
  }
  const name = (body?.name ?? "").trim().replace(/\s+/g, " ").slice(0, 20);
  if (name.length < 2) return fail("Pick a name with at least 2 characters.");

  const store = getStore();
  const existing = (await store.listPlayers(doc.code)).find((p) => p.wallet === wallet.toBase58());
  if (existing) return ok({ token: existing.token, name: existing.name, rejoined: true });

  // The onchain entry is the ticket: no entry, no seat.
  if (!skipChain() && !(await entryExists(connection(), new PublicKey(doc.chain.battle), wallet))) {
    return fail("Your join transaction isn't confirmed yet. Give it a few seconds and try again.", 409);
  }
  const token = newSecret();
  await store.addPlayer(doc.code, { wallet: wallet.toBase58(), name, token, joinedAt: Date.now(), joinTx: body?.joinTx });
  return ok({ token, name });
}
