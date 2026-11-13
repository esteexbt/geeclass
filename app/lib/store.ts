// Storage for live battle state.
// In-memory by default (great for one long-running server and local dev).
// Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to use Supabase instead (needed on serverless hosts).
// Supabase schema: see supabase/schema.sql in the repo root.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Answer, BattleDoc, Player } from "./game";

export interface Store {
  createBattle(doc: BattleDoc): Promise<void>;
  getBattle(code: string): Promise<BattleDoc | null>;
  saveBattle(doc: BattleDoc): Promise<void>;
  addPlayer(code: string, p: Player): Promise<boolean>; // false if already joined
  listPlayers(code: string): Promise<Player[]>;
  addAnswer(code: string, a: Answer): Promise<boolean>; // false if already answered
  listAnswers(code: string): Promise<Answer[]>;
}

class MemoryStore implements Store {
  private battles = new Map<string, BattleDoc>();
  private players = new Map<string, Player[]>();
  private answers = new Map<string, Answer[]>();

  async createBattle(doc: BattleDoc) {
    this.battles.set(doc.code, structuredClone(doc));
    this.players.set(doc.code, []);
    this.answers.set(doc.code, []);
  }
  async getBattle(code: string) {
    const d = this.battles.get(code);
    return d ? structuredClone(d) : null;
  }
  async saveBattle(doc: BattleDoc) {
    this.battles.set(doc.code, structuredClone(doc));
  }
  async addPlayer(code: string, p: Player) {
    const list = this.players.get(code) ?? [];
    if (list.some((x) => x.wallet === p.wallet)) return false;
    list.push({ ...p });
    this.players.set(code, list);
    return true;
  }
  async listPlayers(code: string) {
    return [...(this.players.get(code) ?? [])];
  }
  async addAnswer(code: string, a: Answer) {
    const list = this.answers.get(code) ?? [];
    if (list.some((x) => x.wallet === a.wallet && x.qi === a.qi)) return false;
    list.push({ ...a });
    this.answers.set(code, list);
    return true;
  }
  async listAnswers(code: string) {
    return [...(this.answers.get(code) ?? [])];
  }
}

class SupabaseStore implements Store {
  constructor(private db: SupabaseClient) {}

  async createBattle(doc: BattleDoc) {
    const { error } = await this.db.from("battles").insert({ code: doc.code, doc });
    if (error) throw error;
  }
  async getBattle(code: string) {
    const { data, error } = await this.db.from("battles").select("doc").eq("code", code).maybeSingle();
    if (error) throw error;
    return (data?.doc as BattleDoc) ?? null;
  }
  async saveBattle(doc: BattleDoc) {
    const { error } = await this.db.from("battles").update({ doc }).eq("code", doc.code);
    if (error) throw error;
  }
  async addPlayer(code: string, p: Player) {
    const { error } = await this.db.from("players").insert({
      battle_code: code,
      wallet: p.wallet,
      name: p.name,
      token: p.token,
      joined_at: p.joinedAt,
      join_tx: p.joinTx ?? null,
    });
    if (error?.code === "23505") return false;
    if (error) throw error;
    return true;
  }
  async listPlayers(code: string) {
    const { data, error } = await this.db
      .from("players")
      .select("*")
      .eq("battle_code", code)
      .order("joined_at");
    if (error) throw error;
    return (data ?? []).map((r) => ({
      wallet: r.wallet,
      name: r.name,
      token: r.token,
      joinedAt: Number(r.joined_at),
      joinTx: r.join_tx ?? undefined,
    }));
  }
  async addAnswer(code: string, a: Answer) {
    const { error } = await this.db.from("answers").insert({
      battle_code: code,
      wallet: a.wallet,
      qi: a.qi,
      choice: a.choice,
      ms: a.ms,
      correct: a.correct,
      points: a.points,
    });
    if (error?.code === "23505") return false;
    if (error) throw error;
    return true;
  }
  async listAnswers(code: string) {
    const { data, error } = await this.db.from("answers").select("*").eq("battle_code", code);
    if (error) throw error;
    return (data ?? []).map((r) => ({
      wallet: r.wallet,
      qi: r.qi,
      choice: r.choice,
      ms: r.ms,
      correct: r.correct,
      points: r.points,
    }));
  }
}

const g = globalThis as unknown as { __geeclassStore?: Store };

export function getStore(): Store {
  if (!g.__geeclassStore) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    g.__geeclassStore =
      url && key
        ? new SupabaseStore(createClient(url, key, { auth: { persistSession: false } }))
        : new MemoryStore();
  }
  return g.__geeclassStore;
}
