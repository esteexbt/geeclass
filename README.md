# GeeClass

**Study battles with real prize pools, settled on Solana.**

A lecturer, class rep or brand pastes course notes. GeeClass turns them into a quiz, and the sponsor locks a USDC prize in a Solana program before anyone plays. Students join from their phones, a voice host runs a live timed battle, and the top players are paid straight from the vault the moment it ends.

Built solo for the Dev3pack Global Hackathon 2026.

- **Live demo:** _add link after deploy_
- **Demo video (under 3 min):** _add link_
- **Program (devnet):** `H6Ue9aCKtRKbGM2gBH2obMeCqBniCsSkgV5QoPFLL6XF` · [Explorer](https://explorer.solana.com/address/H6Ue9aCKtRKbGM2gBH2obMeCqBniCsSkgV5QoPFLL6XF?cluster=devnet)
- **Test USDC mint (devnet):** `MINT_AFTER_SETUP`

## The problem

Students revise alone and late. Sponsors (lecturers, student bodies, brands) already fund campus quizzes and competitions, but prizes are promised verbally and paid "later", sometimes never, and nobody can check if the questions or winners were fair.

## How GeeClass fixes it

| Trust problem | What GeeClass does onchain |
|---|---|
| "Is the prize real?" | The full prize is moved into a program-owned vault **before** the battle opens. Anyone can see the balance. |
| "Will the winners actually be paid?" | One `settle_battle` instruction pays every winner their share in a single transaction. |
| "Were the questions changed mid-battle?" | A SHA-256 fingerprint of the quiz and answer key is stored onchain at creation. When the battle ends, the quiz is revealed and any viewer can recompute the fingerprint in their browser. |
| "Did the host pay a friend?" | Winners must have an onchain entry created by joining *before* the battle. The host and sponsor are blocked from joining. A fingerprint of the full scoreboard is stored at payout. |
| "What if the host disappears?" | After the settle deadline, the sponsor can cancel and get every cent back. There is no other way out of the vault. |

## The Solana program

`programs/geeclass/src/lib.rs`, written in Rust with Anchor.

| Instruction | Who signs | What it does |
|---|---|---|
| `create_battle` | Sponsor | Validates the split (1–3 places, totals 100%), deadlines and title; creates the `Battle` PDA and a token vault PDA; transfers the prize in with `transfer_checked`; stores the quiz commitment. |
| `join_battle` | Player | Creates an `Entry` PDA (`["entry", battle, player]`); enforces join deadline and max players; rejects the host and sponsor. |
| `settle_battle` | Host | Takes `[entry, token account]` pairs in rank order via `remaining_accounts`; checks each entry belongs to this battle, each token account is owned by that player and uses the prize mint, and no one wins twice; pays shares; refunds unfilled places and rounding dust to the sponsor; closes the vault; stores the results hash. Zero winners returns the whole pool. |
| `cancel_battle` | Sponsor | Full refund if nobody joined, or after the settle deadline. |

PDAs: `Battle ["battle", sponsor, battle_id]`, vault `["vault", battle]`, `Entry ["entry", battle, player]`. Events are emitted for every state change. The IDL is in `idl/geeclass.json`.

## The app

`app/` is a Next.js 16 app, mobile-first.

- **Wallets:** Solana Wallet Adapter with Wallet Standard discovery (Phantom, Solflare, Backpack) plus **Mobile Wallet Adapter** for Android and Solana Seeker.
- **Solana libraries:** `@solana/web3.js`, `@solana/spl-token` (associated token accounts, idempotent ATA creation for winners, mint-to for the faucet), hand-encoded Anchor instructions and account decoding in `app/lib/geeclass.ts`.
- **AI questions:** paste notes (or use the sample), pick count and difficulty. Uses Gemini, any OpenAI-compatible API, or Claude, whichever key is set. With no key it falls back to a built-in offline generator, so the demo never breaks. Output is validated and options are reshuffled so answer position gives nothing away.
- **Voice host:** reads every question, reacts to how the class did, and announces winners. ElevenLabs when `ELEVENLABS_API_KEY` is set, otherwise the browser's own voice.
- **Fair play:** the answer key never leaves the server during a question; standings are hidden while the clock runs; answers are timed server-side; each player can answer once.
- **Scoring:** 500–1000 points per correct answer, more for faster answers. Ties go to the faster total time.

## Run it locally

Requirements: Node 20+, a Solana wallet on devnet.

```bash
cd app
cp .env.example .env.local
npm install
npm run setup:devnet   # creates a free test-USDC mint; paste the printed lines into .env.local
npm run dev
```

Open http://localhost:3000, get devnet SOL and test USDC on the **Faucet** page, then host a battle. Join from a second wallet (another browser profile or your phone) to play.

Tests: `npm test` (game rules, scoring, answer-key secrecy, quiz validation) and `cargo test` in the repo root (payout split and rounding).

## Deploy the program

Easiest path, no local Rust toolchain needed: open [Solana Playground](https://beta.solpg.io), create an Anchor project, paste `programs/geeclass/src/lib.rs`, connect the Playground wallet on devnet, then **Build** and **Deploy**. Copy the program ID into `NEXT_PUBLIC_PROGRAM_ID` and the table at the top of this README.

With the Anchor CLI: `anchor build && anchor deploy --provider.cluster devnet`.

## Deploy the app

- **Vercel + Supabase (recommended):** run `supabase/schema.sql` in your Supabase project, set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, plus the variables from `.env.example`.
- **Any single long-running Node host** (Render, Railway, a VPS): the in-memory store is enough.

## What's next

- Per-player answer commitments onchain, so scoring is verifiable answer by answer, not just by scoreboard hash.
- Recurring sponsored leagues per course, with a season leaderboard.
- Naira on-ramp for sponsors and off-ramp for winners.
- Publish to the Solana dApp Store for Seeker.

## License

MIT
