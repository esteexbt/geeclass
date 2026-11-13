// Client for the GeeClass Solana program.
// Instructions are encoded by hand (Anchor discriminator + Borsh) so the app
// stays light and every byte sent to the chain is visible here.

import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  type AccountMeta,
  type Connection,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

export const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID || "H6Ue9aCKtRKbGM2gBH2obMeCqBniCsSkgV5QoPFLL6XF",
);

const DISC = {
  createBattle: [2, 249, 54, 216, 42, 99, 187, 102],
  joinBattle: [126, 0, 69, 130, 127, 145, 54, 100],
  settleBattle: [4, 146, 32, 157, 82, 216, 214, 28],
  cancelBattle: [234, 61, 97, 187, 97, 170, 101, 141],
  battleAccount: [81, 148, 121, 71, 63, 166, 116, 24],
  entryAccount: [63, 18, 152, 113, 215, 246, 221, 250],
};

// ---------- tiny Borsh writer / reader ----------

class Writer {
  private parts: number[] = [];
  bytes(b: ArrayLike<number>) {
    for (let i = 0; i < b.length; i++) this.parts.push(b[i]);
    return this;
  }
  u8(n: number) {
    this.parts.push(n & 0xff);
    return this;
  }
  u16(n: number) {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, n, true);
    return this.bytes(b);
  }
  u32(n: number) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n, true);
    return this.bytes(b);
  }
  u64(n: bigint) {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, n, true);
    return this.bytes(b);
  }
  i64(n: bigint) {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigInt64(0, n, true);
    return this.bytes(b);
  }
  string(s: string) {
    const enc = new TextEncoder().encode(s);
    return this.u32(enc.length).bytes(enc);
  }
  pubkey(p: PublicKey) {
    return this.bytes(p.toBytes());
  }
  build() {
    return Buffer.from(this.parts);
  }
}

class Reader {
  private o = 0;
  private dv: DataView;
  constructor(private b: Uint8Array) {
    this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
  skip(n: number) {
    this.o += n;
  }
  u8() {
    return this.b[this.o++];
  }
  u16() {
    const v = this.dv.getUint16(this.o, true);
    this.o += 2;
    return v;
  }
  u32() {
    const v = this.dv.getUint32(this.o, true);
    this.o += 4;
    return v;
  }
  u64() {
    const v = this.dv.getBigUint64(this.o, true);
    this.o += 8;
    return v;
  }
  i64() {
    const v = this.dv.getBigInt64(this.o, true);
    this.o += 8;
    return v;
  }
  bytes(n: number) {
    const v = this.b.slice(this.o, this.o + n);
    this.o += n;
    return v;
  }
  pubkey() {
    return new PublicKey(this.bytes(32));
  }
  string() {
    return new TextDecoder().decode(this.bytes(this.u32()));
  }
}

// ---------- PDAs ----------

export function battleIdBytes(battleId: bigint) {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, battleId, true);
  return b;
}

export function findBattlePda(sponsor: PublicKey, battleId: bigint) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("battle"), sponsor.toBuffer(), Buffer.from(battleIdBytes(battleId))],
    PROGRAM_ID,
  )[0];
}

export function findVaultPda(battle: PublicKey) {
  return PublicKey.findProgramAddressSync([Buffer.from("vault"), battle.toBuffer()], PROGRAM_ID)[0];
}

export function findEntryPda(battle: PublicKey, player: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("entry"), battle.toBuffer(), player.toBuffer()],
    PROGRAM_ID,
  )[0];
}

// ---------- instructions ----------

export interface CreateBattleArgs {
  sponsor: PublicKey;
  host: PublicKey;
  mint: PublicKey;
  battleId: bigint;
  title: string;
  prizeAmount: bigint; // base units
  payoutBps: number[]; // e.g. [5000, 3000, 2000]
  maxPlayers: number;
  joinDeadline: number; // unix seconds
  settleDeadline: number; // unix seconds
  quizCommit: Uint8Array; // 32 bytes
}

export function createBattleIx(a: CreateBattleArgs) {
  const battle = findBattlePda(a.sponsor, a.battleId);
  const vault = findVaultPda(battle);
  const sponsorAta = getAssociatedTokenAddressSync(a.mint, a.sponsor);

  const w = new Writer()
    .bytes(DISC.createBattle)
    .u64(a.battleId)
    .string(a.title)
    .u64(a.prizeAmount)
    .u32(a.payoutBps.length);
  a.payoutBps.forEach((b) => w.u16(b));
  w.u16(a.maxPlayers)
    .i64(BigInt(a.joinDeadline))
    .i64(BigInt(a.settleDeadline))
    .bytes(a.quizCommit)
    .pubkey(a.host);

  const keys: AccountMeta[] = [
    { pubkey: a.sponsor, isSigner: true, isWritable: true },
    { pubkey: a.mint, isSigner: false, isWritable: false },
    { pubkey: sponsorAta, isSigner: false, isWritable: true },
    { pubkey: battle, isSigner: false, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  return { ix: new TransactionInstruction({ programId: PROGRAM_ID, keys, data: w.build() }), battle, vault };
}

export function joinBattleIx(player: PublicKey, battle: PublicKey) {
  const entry = findEntryPda(battle, player);
  const keys: AccountMeta[] = [
    { pubkey: player, isSigner: true, isWritable: true },
    { pubkey: battle, isSigner: false, isWritable: true },
    { pubkey: entry, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  return {
    ix: new TransactionInstruction({ programId: PROGRAM_ID, keys, data: Buffer.from(DISC.joinBattle) }),
    entry,
  };
}

export interface SettleArgs {
  host: PublicKey;
  battle: PublicKey;
  sponsor: PublicKey;
  mint: PublicKey;
  winners: PublicKey[]; // ranked, 1st first
  resultsHash: Uint8Array; // 32 bytes
}

/** Returns the instructions to settle: create any missing winner token accounts, then pay out. */
export function settleBattleIxs(a: SettleArgs) {
  const vault = findVaultPda(a.battle);
  const sponsorAta = getAssociatedTokenAddressSync(a.mint, a.sponsor);
  const pre: TransactionInstruction[] = [];
  const remaining: AccountMeta[] = [];

  for (const w of a.winners) {
    const ata = getAssociatedTokenAddressSync(a.mint, w);
    // The host covers the small rent if a winner has never held this token.
    pre.push(createAssociatedTokenAccountIdempotentInstruction(a.host, ata, w, a.mint));
    remaining.push({ pubkey: findEntryPda(a.battle, w), isSigner: false, isWritable: false });
    remaining.push({ pubkey: ata, isSigner: false, isWritable: true });
  }
  pre.push(createAssociatedTokenAccountIdempotentInstruction(a.host, sponsorAta, a.sponsor, a.mint));

  const keys: AccountMeta[] = [
    { pubkey: a.host, isSigner: true, isWritable: true },
    { pubkey: a.battle, isSigner: false, isWritable: true },
    { pubkey: a.sponsor, isSigner: false, isWritable: true },
    { pubkey: a.mint, isSigner: false, isWritable: false },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: sponsorAta, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ...remaining,
  ];
  const data = new Writer().bytes(DISC.settleBattle).bytes(a.resultsHash).build();
  return [...pre, new TransactionInstruction({ programId: PROGRAM_ID, keys, data })];
}

export function cancelBattleIx(sponsor: PublicKey, battle: PublicKey, mint: PublicKey) {
  const keys: AccountMeta[] = [
    { pubkey: sponsor, isSigner: true, isWritable: true },
    { pubkey: battle, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: findVaultPda(battle), isSigner: false, isWritable: true },
    { pubkey: getAssociatedTokenAddressSync(mint, sponsor), isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];
  return new TransactionInstruction({ programId: PROGRAM_ID, keys, data: Buffer.from(DISC.cancelBattle) });
}

// ---------- account decoding ----------

export type BattleStatus = "open" | "settled" | "cancelled";

export interface OnchainBattle {
  address: string;
  sponsor: string;
  host: string;
  mint: string;
  battleId: string;
  title: string;
  prizeAmount: string;
  payoutBps: number[];
  winnerSlots: number;
  maxPlayers: number;
  playerCount: number;
  joinDeadline: number;
  settleDeadline: number;
  quizCommit: string; // hex
  resultsHash: string; // hex
  winners: string[];
  payouts: string[];
  status: BattleStatus;
  createdAt: number;
}

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export function decodeBattle(address: PublicKey, data: Uint8Array): OnchainBattle {
  const disc = Array.from(data.slice(0, 8));
  if (disc.join() !== DISC.battleAccount.join()) throw new Error("Not a GeeClass battle account");
  const r = new Reader(data);
  r.skip(8);
  const sponsor = r.pubkey();
  const host = r.pubkey();
  const mint = r.pubkey();
  const battleId = r.u64();
  const title = r.string();
  const prizeAmount = r.u64();
  const payoutBps = [r.u16(), r.u16(), r.u16()];
  const winnerSlots = r.u8();
  const maxPlayers = r.u16();
  const playerCount = r.u16();
  const joinDeadline = Number(r.i64());
  const settleDeadline = Number(r.i64());
  const quizCommit = toHex(r.bytes(32));
  const resultsHash = toHex(r.bytes(32));
  const winners = [r.pubkey(), r.pubkey(), r.pubkey()];
  const payouts = [r.u64(), r.u64(), r.u64()];
  const statusByte = r.u8();
  const createdAt = Number(r.i64());
  return {
    address: address.toBase58(),
    sponsor: sponsor.toBase58(),
    host: host.toBase58(),
    mint: mint.toBase58(),
    battleId: battleId.toString(),
    title,
    prizeAmount: prizeAmount.toString(),
    payoutBps: payoutBps.slice(0, winnerSlots),
    winnerSlots,
    maxPlayers,
    playerCount,
    joinDeadline,
    settleDeadline,
    quizCommit,
    resultsHash,
    winners: winners.filter((w) => !w.equals(PublicKey.default)).map((w) => w.toBase58()),
    payouts: payouts.slice(0, winnerSlots).map((p) => p.toString()),
    status: (["open", "settled", "cancelled"] as const)[statusByte] ?? "open",
    createdAt,
  };
}

export async function fetchBattle(connection: Connection, battle: PublicKey) {
  const info = await connection.getAccountInfo(battle, "confirmed");
  if (!info) return null;
  return decodeBattle(battle, info.data);
}

export async function entryExists(connection: Connection, battle: PublicKey, player: PublicKey) {
  const info = await connection.getAccountInfo(findEntryPda(battle, player), "confirmed");
  if (!info || !info.owner.equals(PROGRAM_ID)) return false;
  return Array.from(info.data.slice(0, 8)).join() === DISC.entryAccount.join();
}

// ---------- hashing ----------

export async function sha256(input: string): Promise<Uint8Array> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return new Uint8Array(digest);
}

export const hex = toHex;

export function newBattleId(): bigint {
  const b = new Uint8Array(8);
  globalThis.crypto.getRandomValues(b);
  return new DataView(b.buffer).getBigUint64(0, true);
}
