//! GeeClass: sponsored study battles with an onchain prize pool.
//!
//! Flow
//! 1. A sponsor (lecturer, student group, brand) calls `create_battle` and locks the
//!    whole prize in a program-owned vault. The quiz is committed by hash up front,
//!    so the questions can't be swapped after the battle starts.
//! 2. Students call `join_battle`, which writes an onchain entry for each player.
//! 3. After the live battle, the host calls `settle_battle`. The program checks every
//!    winner really joined, pays each one their share in the same transaction and
//!    returns anything left over to the sponsor.
//! 4. If the host never settles, the sponsor can `cancel_battle` after the settle
//!    deadline and get the full pool back. Funds can never get stuck.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, TransferChecked};

declare_id!("H6Ue9aCKtRKbGM2gBH2obMeCqBniCsSkgV5QoPFLL6XF");

pub const MAX_WINNERS: usize = 3;
pub const MAX_TITLE_LEN: usize = 64;
pub const BPS_DENOMINATOR: u64 = 10_000;

pub const BATTLE_SEED: &[u8] = b"battle";
pub const VAULT_SEED: &[u8] = b"vault";
pub const ENTRY_SEED: &[u8] = b"entry";

#[program]
pub mod geeclass {
    use super::*;

    #[allow(clippy::too_many_arguments)]
    pub fn create_battle(
        ctx: Context<CreateBattle>,
        battle_id: u64,
        title: String,
        prize_amount: u64,
        payout_bps: Vec<u16>,
        max_players: u16,
        join_deadline: i64,
        settle_deadline: i64,
        quiz_commit: [u8; 32],
        host: Pubkey,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;

        require!(title.len() <= MAX_TITLE_LEN, GeeClassError::TitleTooLong);
        require!(prize_amount > 0, GeeClassError::ZeroPrize);
        require!(max_players >= 2, GeeClassError::TooFewPlayers);
        require!(join_deadline > now, GeeClassError::BadDeadline);
        require!(settle_deadline > join_deadline, GeeClassError::BadDeadline);
        validate_payout_split(&payout_bps)?;

        let battle = &mut ctx.accounts.battle;
        battle.sponsor = ctx.accounts.sponsor.key();
        battle.host = host;
        battle.mint = ctx.accounts.mint.key();
        battle.battle_id = battle_id;
        battle.title = title;
        battle.prize_amount = prize_amount;
        battle.payout_bps = [0; MAX_WINNERS];
        for (i, bps) in payout_bps.iter().enumerate() {
            battle.payout_bps[i] = *bps;
        }
        battle.winner_slots = payout_bps.len() as u8;
        battle.max_players = max_players;
        battle.player_count = 0;
        battle.join_deadline = join_deadline;
        battle.settle_deadline = settle_deadline;
        battle.quiz_commit = quiz_commit;
        battle.results_hash = [0; 32];
        battle.winners = [Pubkey::default(); MAX_WINNERS];
        battle.payouts = [0; MAX_WINNERS];
        battle.status = BattleStatus::Open;
        battle.created_at = now;
        battle.bump = ctx.bumps.battle;
        battle.vault_bump = ctx.bumps.vault;

        // Lock the full prize in the vault before anyone can join.
        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.sponsor_token_account.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.sponsor.to_account_info(),
                },
            ),
            prize_amount,
            ctx.accounts.mint.decimals,
        )?;

        emit!(BattleCreated {
            battle: battle.key(),
            sponsor: battle.sponsor,
            host,
            mint: battle.mint,
            prize_amount,
            join_deadline,
        });
        Ok(())
    }

    pub fn join_battle(ctx: Context<JoinBattle>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let battle = &mut ctx.accounts.battle;
        let player = ctx.accounts.player.key();

        require!(battle.status == BattleStatus::Open, GeeClassError::BattleNotOpen);
        require!(now < battle.join_deadline, GeeClassError::JoinClosed);
        require!(battle.player_count < battle.max_players, GeeClassError::BattleFull);
        // The people who control the money can't also compete for it.
        require!(
            player != battle.host && player != battle.sponsor,
            GeeClassError::OrganizerCannotPlay
        );

        let entry = &mut ctx.accounts.entry;
        entry.battle = battle.key();
        entry.player = player;
        entry.joined_at = now;
        entry.bump = ctx.bumps.entry;

        battle.player_count = battle
            .player_count
            .checked_add(1)
            .ok_or(GeeClassError::MathOverflow)?;

        emit!(PlayerJoined {
            battle: battle.key(),
            player,
            player_count: battle.player_count,
        });
        Ok(())
    }

    /// Pays the winners and refunds any leftover to the sponsor, in one transaction.
    ///
    /// `remaining_accounts` holds one pair per winner, ranked 1st to last:
    /// `[entry_pda, winner_token_account]`.
    pub fn settle_battle<'info>(
        ctx: Context<'_, '_, 'info, 'info, SettleBattle<'info>>,
        results_hash: [u8; 32],
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let battle_key = ctx.accounts.battle.key();

        {
            let battle = &ctx.accounts.battle;
            require!(battle.status == BattleStatus::Open, GeeClassError::BattleNotOpen);
            require!(now <= battle.settle_deadline, GeeClassError::SettleWindowClosed);
        }

        let remaining = ctx.remaining_accounts;
        // Zero winners is allowed: if nobody scored, the whole pool goes back to the sponsor.
        require!(remaining.len() % 2 == 0, GeeClassError::BadWinnerAccounts);
        let winner_count = remaining.len() / 2;
        require!(
            winner_count <= ctx.accounts.battle.winner_slots as usize,
            GeeClassError::TooManyWinners
        );

        let signer_seeds: &[&[&[u8]]] = &[&[
            BATTLE_SEED,
            ctx.accounts.battle.sponsor.as_ref(),
            &ctx.accounts.battle.battle_id.to_le_bytes(),
            &[ctx.accounts.battle.bump],
        ]];

        let mut winners = [Pubkey::default(); MAX_WINNERS];
        let mut payouts = [0u64; MAX_WINNERS];
        let mut paid_total: u64 = 0;

        for i in 0..winner_count {
            let entry_info = &remaining[i * 2];
            let token_info = &remaining[i * 2 + 1];

            // Account::try_from checks owner program + discriminator.
            let entry: Account<Entry> = Account::try_from(entry_info)?;
            require_keys_eq!(entry.battle, battle_key, GeeClassError::EntryNotInBattle);

            let winner_token: Account<TokenAccount> = Account::try_from(token_info)?;
            require_keys_eq!(winner_token.owner, entry.player, GeeClassError::WrongTokenOwner);
            require_keys_eq!(winner_token.mint, ctx.accounts.mint.key(), GeeClassError::WrongMint);

            // No player can win twice.
            for w in winners.iter().take(i) {
                require_keys_neq!(*w, entry.player, GeeClassError::DuplicateWinner);
            }

            let share = payout_share(
                ctx.accounts.battle.prize_amount,
                ctx.accounts.battle.payout_bps[i],
            )?;

            if share > 0 {
                token::transfer_checked(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        TransferChecked {
                            from: ctx.accounts.vault.to_account_info(),
                            mint: ctx.accounts.mint.to_account_info(),
                            to: token_info.clone(),
                            authority: ctx.accounts.battle.to_account_info(),
                        },
                        signer_seeds,
                    ),
                    share,
                    ctx.accounts.mint.decimals,
                )?;
            }

            winners[i] = entry.player;
            payouts[i] = share;
            paid_total = paid_total.checked_add(share).ok_or(GeeClassError::MathOverflow)?;
        }

        // Places nobody filled (e.g. only 2 players for 3 prizes) go back to the sponsor.
        ctx.accounts.vault.reload()?;
        let leftover = ctx.accounts.vault.amount;
        refund_and_close_vault(
            &ctx.accounts.token_program,
            &ctx.accounts.vault,
            &ctx.accounts.mint,
            &ctx.accounts.sponsor_token_account,
            &ctx.accounts.sponsor,
            &ctx.accounts.battle.to_account_info(),
            signer_seeds,
            leftover,
        )?;

        let battle = &mut ctx.accounts.battle;
        battle.status = BattleStatus::Settled;
        battle.results_hash = results_hash;
        battle.winners = winners;
        battle.payouts = payouts;

        emit!(BattleSettled {
            battle: battle_key,
            winners,
            payouts,
            refunded: leftover,
            results_hash,
        });
        Ok(())
    }

    /// Sponsor gets the whole pool back if nobody joined, or if the host
    /// missed the settle deadline.
    pub fn cancel_battle(ctx: Context<CancelBattle>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let battle_key = ctx.accounts.battle.key();
        {
            let battle = &ctx.accounts.battle;
            require!(battle.status == BattleStatus::Open, GeeClassError::BattleNotOpen);
            require!(
                battle.player_count == 0 || now > battle.settle_deadline,
                GeeClassError::CannotCancelYet
            );
        }

        let signer_seeds: &[&[&[u8]]] = &[&[
            BATTLE_SEED,
            ctx.accounts.battle.sponsor.as_ref(),
            &ctx.accounts.battle.battle_id.to_le_bytes(),
            &[ctx.accounts.battle.bump],
        ]];

        let amount = ctx.accounts.vault.amount;
        refund_and_close_vault(
            &ctx.accounts.token_program,
            &ctx.accounts.vault,
            &ctx.accounts.mint,
            &ctx.accounts.sponsor_token_account,
            &ctx.accounts.sponsor,
            &ctx.accounts.battle.to_account_info(),
            signer_seeds,
            amount,
        )?;

        ctx.accounts.battle.status = BattleStatus::Cancelled;
        emit!(BattleCancelled { battle: battle_key, refunded: amount });
        Ok(())
    }
}

// ---------- helpers ----------

pub fn validate_payout_split(payout_bps: &[u16]) -> Result<()> {
    require!(
        !payout_bps.is_empty() && payout_bps.len() <= MAX_WINNERS,
        GeeClassError::BadPayoutSplit
    );
    let mut total: u64 = 0;
    for bps in payout_bps {
        require!(*bps > 0, GeeClassError::BadPayoutSplit);
        total += *bps as u64;
    }
    require!(total == BPS_DENOMINATOR, GeeClassError::BadPayoutSplit);
    Ok(())
}

pub fn payout_share(prize_amount: u64, bps: u16) -> Result<u64> {
    let share = (prize_amount as u128)
        .checked_mul(bps as u128)
        .ok_or(GeeClassError::MathOverflow)?
        / BPS_DENOMINATOR as u128;
    u64::try_from(share).map_err(|_| error!(GeeClassError::MathOverflow))
}

#[allow(clippy::too_many_arguments)]
fn refund_and_close_vault<'info>(
    token_program: &Program<'info, Token>,
    vault: &Account<'info, TokenAccount>,
    mint: &Account<'info, Mint>,
    sponsor_token_account: &Account<'info, TokenAccount>,
    sponsor: &AccountInfo<'info>,
    battle: &AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
    amount: u64,
) -> Result<()> {
    if amount > 0 {
        token::transfer_checked(
            CpiContext::new_with_signer(
                token_program.to_account_info(),
                TransferChecked {
                    from: vault.to_account_info(),
                    mint: mint.to_account_info(),
                    to: sponsor_token_account.to_account_info(),
                    authority: battle.clone(),
                },
                signer_seeds,
            ),
            amount,
            mint.decimals,
        )?;
    }
    // Vault rent goes back to the sponsor too.
    token::close_account(CpiContext::new_with_signer(
        token_program.to_account_info(),
        CloseAccount {
            account: vault.to_account_info(),
            destination: sponsor.clone(),
            authority: battle.clone(),
        },
        signer_seeds,
    ))
}

// ---------- accounts ----------

#[derive(Accounts)]
#[instruction(battle_id: u64)]
pub struct CreateBattle<'info> {
    #[account(mut)]
    pub sponsor: Signer<'info>,

    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = sponsor,
    )]
    pub sponsor_token_account: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = sponsor,
        space = 8 + Battle::INIT_SPACE,
        seeds = [BATTLE_SEED, sponsor.key().as_ref(), &battle_id.to_le_bytes()],
        bump,
    )]
    pub battle: Account<'info, Battle>,

    #[account(
        init,
        payer = sponsor,
        seeds = [VAULT_SEED, battle.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = battle,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct JoinBattle<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    #[account(mut)]
    pub battle: Account<'info, Battle>,

    #[account(
        init,
        payer = player,
        space = 8 + Entry::INIT_SPACE,
        seeds = [ENTRY_SEED, battle.key().as_ref(), player.key().as_ref()],
        bump,
    )]
    pub entry: Account<'info, Entry>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettleBattle<'info> {
    pub host: Signer<'info>,

    #[account(
        mut,
        has_one = host @ GeeClassError::NotHost,
        has_one = sponsor @ GeeClassError::WrongSponsor,
        has_one = mint @ GeeClassError::WrongMint,
    )]
    pub battle: Account<'info, Battle>,

    /// CHECK: verified by `has_one = sponsor`; only receives the vault rent.
    #[account(mut)]
    pub sponsor: AccountInfo<'info>,

    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [VAULT_SEED, battle.key().as_ref()],
        bump = battle.vault_bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = sponsor,
    )]
    pub sponsor_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CancelBattle<'info> {
    #[account(mut)]
    pub sponsor: Signer<'info>,

    #[account(
        mut,
        has_one = sponsor @ GeeClassError::WrongSponsor,
        has_one = mint @ GeeClassError::WrongMint,
    )]
    pub battle: Account<'info, Battle>,

    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [VAULT_SEED, battle.key().as_ref()],
        bump = battle.vault_bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = sponsor,
    )]
    pub sponsor_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

// ---------- state ----------

#[account]
#[derive(InitSpace)]
pub struct Battle {
    pub sponsor: Pubkey,
    pub host: Pubkey,
    pub mint: Pubkey,
    pub battle_id: u64,
    #[max_len(MAX_TITLE_LEN)]
    pub title: String,
    pub prize_amount: u64,
    /// Share of the prize per place, in basis points (1st, 2nd, 3rd).
    pub payout_bps: [u16; MAX_WINNERS],
    pub winner_slots: u8,
    pub max_players: u16,
    pub player_count: u16,
    pub join_deadline: i64,
    pub settle_deadline: i64,
    /// sha256 of the quiz (questions + answer key + salt), fixed at creation.
    pub quiz_commit: [u8; 32],
    /// sha256 of the full scoreboard, posted at settlement.
    pub results_hash: [u8; 32],
    pub winners: [Pubkey; MAX_WINNERS],
    pub payouts: [u64; MAX_WINNERS],
    pub status: BattleStatus,
    pub created_at: i64,
    pub bump: u8,
    pub vault_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Entry {
    pub battle: Pubkey,
    pub player: Pubkey,
    pub joined_at: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum BattleStatus {
    Open,
    Settled,
    Cancelled,
}

// ---------- events ----------

#[event]
pub struct BattleCreated {
    pub battle: Pubkey,
    pub sponsor: Pubkey,
    pub host: Pubkey,
    pub mint: Pubkey,
    pub prize_amount: u64,
    pub join_deadline: i64,
}

#[event]
pub struct PlayerJoined {
    pub battle: Pubkey,
    pub player: Pubkey,
    pub player_count: u16,
}

#[event]
pub struct BattleSettled {
    pub battle: Pubkey,
    pub winners: [Pubkey; MAX_WINNERS],
    pub payouts: [u64; MAX_WINNERS],
    pub refunded: u64,
    pub results_hash: [u8; 32],
}

#[event]
pub struct BattleCancelled {
    pub battle: Pubkey,
    pub refunded: u64,
}

// ---------- errors ----------

#[error_code]
pub enum GeeClassError {
    #[msg("Title is longer than 64 characters")]
    TitleTooLong,
    #[msg("Prize must be greater than zero")]
    ZeroPrize,
    #[msg("A battle needs room for at least 2 players")]
    TooFewPlayers,
    #[msg("Deadlines must be in the future and settle must come after join")]
    BadDeadline,
    #[msg("Payout split must have 1-3 places, each above zero, adding up to 100%")]
    BadPayoutSplit,
    #[msg("Battle is not open")]
    BattleNotOpen,
    #[msg("Joining has closed for this battle")]
    JoinClosed,
    #[msg("Battle is full")]
    BattleFull,
    #[msg("The host and sponsor cannot play in their own battle")]
    OrganizerCannotPlay,
    #[msg("Only the battle host can do this")]
    NotHost,
    #[msg("Wrong sponsor account")]
    WrongSponsor,
    #[msg("Wrong token mint")]
    WrongMint,
    #[msg("The settle window has closed; the sponsor can now cancel for a refund")]
    SettleWindowClosed,
    #[msg("Winner accounts must be [entry, token account] pairs")]
    BadWinnerAccounts,
    #[msg("More winners than prize places")]
    TooManyWinners,
    #[msg("This entry does not belong to this battle")]
    EntryNotInBattle,
    #[msg("Winner token account is not owned by the winner")]
    WrongTokenOwner,
    #[msg("The same player cannot win twice")]
    DuplicateWinner,
    #[msg("Battle can only be cancelled if nobody joined or the settle deadline passed")]
    CannotCancelYet,
    #[msg("Math overflow")]
    MathOverflow,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_must_total_100_percent() {
        assert!(validate_payout_split(&[5000, 3000, 2000]).is_ok());
        assert!(validate_payout_split(&[10_000]).is_ok());
        assert!(validate_payout_split(&[5000, 3000]).is_err());
        assert!(validate_payout_split(&[]).is_err());
        assert!(validate_payout_split(&[10_000, 0]).is_err());
        assert!(validate_payout_split(&[2500, 2500, 2500, 2500]).is_err());
    }

    #[test]
    fn shares_never_exceed_prize() {
        let prize = 100_000_001; // 100.000001 USDC, an awkward amount
        let split = [5000u16, 3000, 2000];
        let total: u64 = split.iter().map(|b| payout_share(prize, *b).unwrap()).sum();
        assert!(total <= prize);
        assert!(prize - total < 3); // rounding dust only, refunded to sponsor
        assert_eq!(payout_share(u64::MAX, 10_000).unwrap(), u64::MAX);
    }
}
