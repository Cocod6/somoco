# Somoco

A prediction platform built on [Intuition](https://intuition.systems) mainnet (chain 1155, native token `$TRUST`).

You type a prediction in plain English. Claude parses it into a **Triple** — subject, claim, condition — which is written permanently to Intuition's public knowledge graph. From there it's reviewed, opened for staking, and eventually resolved.

```
"Bitcoin will hit $150K before December 2026"
        ↓
[Bitcoin] [reaches $150,000] [before December 2026]
        ↓
written to Intuition mainnet, forever
```

## Why a Triple instead of a row in a database

A prediction stored in a private database is a claim its owner can quietly edit. A prediction stored as a Triple is a public fact anyone can verify, and the same atoms are reused by every other app on Intuition — a prediction about Bitcoin points at *the* Bitcoin atom, not a copy of it.

Somoco keeps two layers apart on purpose:

- **Intuition** holds the real data — the predictions, the resolutions, the reputation.
- **Supabase** holds Somoco's own private bookkeeping: which predictions were approved, which have resolved. So only predictions that went through Somoco's flow appear in the product.

The contract never reads its outcome from Supabase. A database row is forgeable; a signed transaction is not.

## Settlement

Predictions can be staked on with real `$TRUST`. Settlement is a **parimutuel pool**: everyone on the winning side splits the losing side's stake, proportional to what they put in.

- 3% fee, charged **on winnings only** — never on a winner's returned stake
- Early exit while the market is open, keeping 60%; the forfeited 40% is added to the winning side's payout
- Locking is time-derived, not a transaction, so it can't be forgotten
- If the resolver goes dark, anyone can void the market after 30 days and stakes come back

Contracts are Foundry + OpenZeppelin, 60 tests, and live in their own repository — see `contracts/DEPLOYMENTS.md` for deployed addresses.

## Resolution — the part most prediction apps get wrong

A market where the house decides who won is not a market, it's an opinion.

Every prediction carries a **resolution plan** written at submission time: the method, the named sources, and the exact criteria it'll be judged against. Users see the contract up front rather than discovering it at payout.

Somoco also imports markets from Polymarket, and those arrive with their criteria already written — the text UMA's optimistic oracle settles disputes against, already argued over by traders with money at stake. Because each imported prediction keeps a pointer back to its source, it can be settled by **reading** that outcome instead of anyone at Somoco judging it.

## Stack

Next.js 16 (App Router) · TypeScript · wagmi/viem · Privy (wallet + email + embedded wallets) · `@0xintuition/protocol` · Supabase · Claude Haiku for parsing · plain CSS variables, no Tailwind

## Running it

```bash
npm install
npm run dev
```

Needs a `.env.local` — Supabase URL and keys, a Privy app id, an Anthropic API key, and the admin allowlist. Nothing runs against mainnet without a funded wallet.

Database setup lives in `schema.sql`, which is safe to re-run. Row level security is on: the anon key can read, and every write goes through a server route holding the service-role key. That's what makes the admin gate real rather than cosmetic.

## Background jobs

Two unattended jobs, both behind a shared secret, both defaulting to a dry run:

| Route | What it does |
| --- | --- |
| `POST /api/polymarket/mirror` | Imports top Polymarket markets — mints the Triple, writes the row |
| `POST /api/settle` | Resolves imported predictions by reading the source's published outcome |

Neither can be told *what* to write. The mirror imports what Polymarket lists; the settler records the outcome Polymarket published. Both check a hard spend ceiling before every transaction, because there's no human at a wallet prompt to catch a runaway loop.
