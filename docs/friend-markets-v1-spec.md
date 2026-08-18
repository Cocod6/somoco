# Friend markets (PvP) — v1 spec

**Status:** built, 92 contract tests green, **not deployed**. Going live is a
deliberate two-step handover described in §8, and nothing changes for any
existing market until that handover happens.

A friend market is an ordinary Somoco prediction market with two differences:
it never appears in the public feed, and **the people who bet in it decide its
outcome instead of Somoco**.

---

## 1. The problem this had to solve first

The obvious design — "everyone who bet votes, majority wins" — does not work,
because the voters are the people with money on the line. Four friends:

- Ada, Bola and Chidi each stake 0.1 on YES. Dami stakes 0.5 on NO.
- Reality: **NO happened.** Dami should win.

| Rule | What it actually does |
|---|---|
| Majority of wallets | 3 YES voters beat 1 → the wrong side takes Dami's money |
| Weighted by stake | Dami alone outweighs everyone → the biggest wallet always wins |
| Everyone must agree, else void | The YES three simply refuse → refund → **a loser can never lose** |

Each of those pays the majority, the whale, or nobody. None of them pays the
truth, and the third is worse than the others: it makes losing optional.

## 2. The rule v1 uses

**Everyone agrees, or the judge decides.**

1. Every invited wallet votes once, from the resolution date onward. Votes
   cannot be changed — a changeable vote is just a negotiation with the pot on
   the table.
2. **If they all vote the same way, the market settles on the spot.** This is
   the ordinary case; friends usually agree about what happened.
3. **Any disagreement escalates immediately to the judge** — a wallet named when
   the market is created, who must hold no position in it.
4. If someone never votes, the judge may also rule once the voting window
   expires (24h / 3d / 7d, chosen at creation).
5. If the judge goes silent too, `voidAfterTimeout()` on the market is
   permissionless 30 days after the resolution date and refunds everyone. That
   already exists and is already deployed.

Why this holds: refusing to agree does not refund a losing bettor, it just hands
the decision to a disinterested party. Lying gains nothing, so the fast path is
also the honest one.

## 3. Why no deployed contract had to change

`PredictionMarket.resolve()` asks exactly one question:

```solidity
if (msg.sender != IMarketFactory(factory).resolver()) revert NotResolver();
```

It never asks whether the resolver is a person. So the whole feature is a
**resolver contract**: `FriendJury` takes the factory's resolver role and
decides, per market, who may declare the outcome. `PredictionMarket` and
`MarketFactory` are untouched — no redeploy, no migration, no re-audit of the
money-holding code, and the 0.4 TRUST already staked by real users is never
moved.

Two kinds of market then coexist under one factory:

| | Ordinary market | Friend market |
|---|---|---|
| Appears in feed | yes | no |
| Who resolves | Somoco, via `adminResolve` | the voters, or their judge |
| Somoco can resolve it | yes | **no — `adminResolve` reverts `HasJury()`** |
| Somoco can void it | yes | yes (voiding only refunds) |
| 30-day escape hatch | yes | yes |

## 4. Contract — `contracts/src/FriendJury.sol`

State per market: judge, `opensAt` (the market's own resolution date),
`judgeFrom` (`opensAt + voteWindow`), voter list, per-voter vote, tallies, and a
`finalized` flag set **before** the outward call to the market.

| Function | Who | Notes |
|---|---|---|
| `registerJury(market, voters[], judge, voteWindow)` | owner | 2–20 voters, no duplicates, judge not a voter, market must belong to this factory and not be final |
| `castVote(market, outcome)` | a registered voter | once, from `opensAt`; settles the market immediately on a unanimous final vote |
| `judgeResolve(market, outcome)` | the judge | allowed as soon as votes are split, otherwise from `judgeFrom`; **reverts if the judge holds any stake** |
| `adminResolve(market, outcome)` | owner | ordinary markets only — reverts on a friend market |
| `adminVoid(market)` | owner | any market; refunds only |
| `acceptResolverRole()` / `handBackResolverRole(addr)` | anyone / owner | the two-step role handover, and its reverse |

Bounds worth knowing: `MAX_VOTERS = 20`, `voteWindow ∈ [1 hour, 21 days]`. The
21-day ceiling is load-bearing — the market's own `RESOLUTION_TIMEOUT` is 30
days from the resolution date, so a longer window would let the market be voided
out from under a judge who still had the floor. `test_MaxVoteWindowLeavesRoomBeforeTimeout`
asserts that relationship rather than trusting the constants to stay put.

**Tests:** `contracts/test/FriendJury.t.sol`, 32 tests including the four-friend
scenario above, a fuzzed unanimity invariant over group sizes 2–20, the
judge-with-a-stake rejection, and the everyone-vanishes timeout. Full suite: 92
passing.

## 5. App

| Piece | What it does |
|---|---|
| `lib/predictions/friendJury.ts` | ABI + reads/writes. `juryIsLive()` reads `factory.resolver()` from the chain, so the UI needs no flag flipped during the handover |
| `components/JuryPanel.tsx` | Voting UI. Renders nothing unless the market has a jury |
| `components/SettlementPanel.tsx` | Hosts the panel above the pool, so it appears in both the detail view and My predictions |
| `components/SubmitPrediction.tsx` | "bet against friends instead" — invited wallets, judge, voting window, validated client-side |
| `components/ApproveAdmin.tsx` | Registers the jury on-chain right after creating the market |
| `PredictionFeed` / `Trending` | Filter `is_private` out **in JS, not SQL** — a WHERE clause on a column the live DB may not have yet would empty the whole feed |
| `lib/predictions/settlement.ts` | `resolveMarket()` now reads who the resolver is and routes itself, so admin resolution works identically before and after the handover |

**Database (`schema.sql`, not yet run):** `is_private`, `invited_wallets`,
`judge_wallet`, `vote_window_seconds`. These are only ever the creator's
*request*. The binding jury is the one registered on-chain by the admin at
approval; the contract reads its voters from itself and never from Supabase —
same rule that keeps settlement out of a database with a known RLS history.

## 6. What "private" does and does not mean

It means **unlisted**: hidden from somoco's feed, trending and leaderboard.

It does **not** mean private on-chain. The claim is still written to Intuition
as a public, permanent triple, and every stake is a public transaction. Anyone
with the market address can read the whole thing forever. The submit form says
this in as many words.

**v1 also cannot stop an outsider staking.** The deployed `stake()` has no
allowlist, so someone who learns the market address can bet in it even though
they were not invited — they simply get no vote. Enforcing the guest list needs
a new market contract with an allowlist or merkle root, and therefore a new
audit. That is v1.5, deliberately deferred until the feature is proven with real
friends.

## 7. Open decisions for Coco

1. **Fee.** Friend markets currently charge the same 3% of the losing pool as
   any other market. Recommendation: **0% on private markets** — it costs
   nothing at current volume, makes the feature read as social rather than as a
   house edge, and keeps it further from the regulatory question. Needs a
   `creatorFeeBps`-style per-market fee to implement properly, so it is a
   contract change; not in v1.
2. **Terms §9** says Somoco decides outcomes and that the decision is final.
   That is now false for friend markets. `/terms` needs a paragraph.
3. **Funding friction.** An invited friend needs $TRUST to bet and gas to sign.
   Privy embedded wallets solve signup, not funding. This is the real adoption
   blocker, and it is a product problem rather than a contract one.
4. **Who creates the market.** `createMarket` is owner-only, so today Somoco
   creates every friend market from the admin wallet at approval. Permissionless
   creation would need a factory change.

## 8. Going live (not done)

```bash
# 1. deploy, from contracts/
FACTORY=0xCF1893f255DD8d197f3415411658329d432DaC84 \
OWNER=<somoco admin> \
forge script script/DeployFriendJury.s.sol --rpc-url intuition --broadcast

# 2. hand over the resolver role — from the CURRENT resolver key
cast send <FACTORY> "proposeResolver(address)" <JURY> --account <resolver>

# 3. the jury claims it (anyone may send this; it only works if step 2 named it)
cast send <JURY> "acceptResolverRole()" --account <any>

# 4. tell the app where it lives
#    NEXT_PUBLIC_FRIEND_JURY=<JURY>   in .env.local and Vercel
```

Reversing it, from the jury's owner:

```bash
cast send <JURY> "handBackResolverRole(address)" <EOA> --account <owner>
cast send <FACTORY> "acceptResolver()" --account <EOA>
```

**Understand the risk before step 2.** Once the jury holds the role it is on the
resolution path for *every* market, including the ones with real money in them
today. A bug there cannot steal funds — the jury never holds any, and every
payout still comes from the market's own audited math — but it could block
resolution, in which case those markets would eventually be voided by the 30-day
timeout and everyone refunded. Refund, not loss, is the worst case. Step 2 is
also why `resolveMarket()` routes itself: nothing in the app breaks at the
moment the role moves.
