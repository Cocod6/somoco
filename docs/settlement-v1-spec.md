# Somoco Settlement v1 — Contract Spec

**Status:** implemented in `contracts/` (2026-07-21) — 48 tests passing incl. fuzzed solvency invariant. Pending: testnet run, multisigs, audit, legal review.
**Chain:** Intuition mainnet, chain id `1155`, native token `$TRUST`.
**Audience:** the Solidity dev building this. Assumes no knowledge of the Somoco app.

---

## 1. What this is

Somoco is a prediction platform. Users write predictions in plain English; the app
parses them into a claim and publishes it permanently on **Intuition Protocol** as a
Triple (subject / claim / condition). That part is built and live.

What's missing is **money**. Today a prediction carries conviction (via Intuition's
bonding curve) but there is no way to win or lose anything. This spec covers the
settlement layer: a **parimutuel pool** where users stake `$TRUST` on YES or NO,
and at resolution the winning side splits the losing side's stake.

### Why parimutuel and not tradeable shares

A share-based market (Polymarket-style: complete sets, YES/NO tokens, an order book
or AMM) is the better end state and is planned as **v2**. It is explicitly *not* v1,
for one reason: cold-start liquidity. Shares need a counterparty to trade against.
Somoco has no user base yet, so an order book would be empty and an AMM would need
Somoco to seed real capital into every market. A parimutuel pool needs no liquidity
provider at all — it works correctly with ten users — and has a fraction of the
contract surface, which means a cheaper audit.

The accepted cost: **positions cannot be exited freely.** Staking is one-way until
the market locks. See §6 for the lock rule.

---

## 2. Non-goals for v1

Do not build these. They are v2 or later, and building them now expands the audit
scope for no benefit:

- Tradeable YES/NO share tokens, complete-set minting, AMM or order book.
- Secondary market or early exit at a market price.
- Partial position exit.
- Multi-outcome markets. **v1 is binary only** (YES / NO).
- Oracle integration. Resolution is a trusted role in v1 (§7).
- Cross-chain, bridging, or non-native-token staking.
- Interacting with Intuition's MultiVault. See §9 — v1 does **not** deposit into
  the bonding curve.

---

## 3. Architecture

Two contracts.

### `MarketFactory`

Deploys and tracks markets. Uses **EIP-1167 minimal proxy clones** against a single
`PredictionMarket` implementation — one full deployment per market is too expensive
when every prediction creates one.

```solidity
function createMarket(
    bytes32 termId,          // the Intuition Triple id this market settles
    uint64  resolutionDate,  // unix seconds; when the outcome is knowable
    uint64  lockOffset       // seconds before resolutionDate that staking closes
) external returns (address market);

function marketForTerm(bytes32 termId) external view returns (address);
function allMarkets(uint256 index) external view returns (address);
function marketCount() external view returns (uint256);
```

- `termId` is a **bytes32 hex string**, not a number. Intuition Atom and Triple ids
  are bytes32. Never cast through `BigInt`/`uint256` for display or storage — it
  corrupts the format. This has bitten this project before.
- One market per `termId`. Reject duplicates.
- Who may call `createMarket` is a config decision — see §10.
- Emit `MarketCreated(termId, market, resolutionDate, lockOffset)`.

### `PredictionMarket`

One instance (clone) per prediction. Holds all staked `$TRUST` for that market.
Initialized by the factory, not constructed (clones have no constructor args).

---

## 4. State machine

```
  Open ──(block.timestamp >= lockAt)──> Locked ──(resolve)──> Resolved
    │                                      │
    └──────────────(void)──────────────────┴──────────────> Voided
```

| State | Staking | Claiming | How it's entered |
|---|---|---|---|
| `Open` | allowed | no | on creation |
| `Locked` | rejected | no | time-based: `block.timestamp >= lockAt` |
| `Resolved` | rejected | yes | resolver calls `resolve()` |
| `Voided` | rejected | yes (refunds) | `void()` or resolution timeout |

`lockAt = resolutionDate - lockOffset`. Locking is **time-derived, not a
transaction** — do not require anyone to call a `lock()` function, or a market can
be left open past its lock because nobody paid the gas.

---

## 5. Payout math

Let:

- `poolYes` — total staked on YES
- `poolNo` — total staked on NO
- `stake_i` — a given user's stake on the winning side
- `FEE_BPS` — Somoco's commission, **300 (3%)**

**The fee is charged on winnings only, never on a user's own returned stake.**
A user who wins should never receive less than they put in.

If YES wins:

```
losingPool  = poolNo
fee         = losingPool * FEE_BPS / 10_000
distributed = losingPool - fee

payout_i    = stake_i + (stake_i * distributed / poolYes)
```

Symmetric if NO wins.

### Worked example

`poolYes = 100 TRUST`, `poolNo = 100 TRUST`, YES wins, you staked `10 TRUST` on YES.

```
losingPool  = 100
fee         = 100 * 300 / 10000        = 3
distributed = 100 - 3                  = 97
payout      = 10 + (10 * 97 / 100)     = 19.7 TRUST
```

You staked 10, you get 19.7. Somoco takes 3 from the 100 that the losing side
forfeited. Note the fee is **not** `3% of the 200 total pot` — that would take a
cut of the winner's own stake.

### Rounding

Integer division truncates, so the sum of all `payout_i` may be a few wei short of
the pool. That residual dust must not be claimable in a way that lets the last
claimant take it or lets a claim revert for insufficient balance. Leave dust in the
contract; allow the treasury to sweep it only after all claims are settled or after
a long grace period. Use full-precision `mulDiv` (OpenZeppelin `Math.mulDiv`) to
minimise it.

---

## 6. Staking

```solidity
enum Side { Yes, No }

function stake(Side side) external payable;   // native $TRUST
```

- Native token, `msg.value`. No ERC20 path in v1.
- Enforce a minimum stake to keep dust positions from making claim gas exceed the
  payout.
- A user **may stake on both sides** — do not prevent it. It's economically
  pointless but blocking it adds state and edge cases for nothing.
- Repeated stakes on the same side accumulate.
- Reject if `block.timestamp >= lockAt`, or if state is not `Open`.
- Emit `Staked(user, side, amount)`.

**Early exit (added 2026-07-22, implemented in v1.2 contract).** The earlier
"no exit at all" rule conflated two different things: a *free* market-price exit
(genuinely impossible in parimutuel without an order book/AMM) and a *penalized*
flat exit (perfectly feasible — no counterparty needed). Somoco ships the latter:

```solidity
function unstake(Side side) external;   // full-position exit, Open state only
```

- Withdraws the whole of one side's stake, returns `(1 - UNSTAKE_PENALTY_BPS)`
  of it (kept **60%**); the forfeited **40%** stays in the pool.
- The forfeited amount accrues to `forfeitPool` and is added to the winning
  side's distributable pot at resolution — it rewards conviction (holders get
  the bailers' forfeit), and Somoco earns only its normal 3%, nothing extra.
- Only while `Open` (before lock). No partial exit — unstake YES and NO
  separately for a full position each.
- On a void the forfeit pot has no rightful winner and is left for the dust
  sweep (goes to treasury after the grace period).

Balance invariant across arbitrary stake/unstake sequences:
`balance == poolYes + poolNo + forfeitPool` (fuzz-tested).

---

## 7. Resolution

```solidity
enum Outcome { Unresolved, Yes, No }

function resolve(Outcome outcome) external onlyResolver;
```

**v1 resolution is a trusted role.** A `resolver` address (Somoco's admin) declares
the outcome. There is no oracle, no dispute window, no challenge mechanism in v1.
This is the single biggest trust assumption in the system and it must be stated
plainly in the UI — users are trusting Somoco to call outcomes honestly.

Requirements:

- Only callable when state is `Locked`. Not before lock, not twice.
- Only `Outcome.Yes` or `Outcome.No` — reject `Unresolved`.
- `resolver` must be a **multisig**, not a single EOA. This address can direct every
  market's funds; a single compromised key drains the platform.
- The resolver role must be transferable, using a **two-step** handover
  (`propose` / `accept`) so a typo cannot brick every market permanently.
- Emit `Resolved(outcome, poolYes, poolNo, fee)`.

### Critical: on-chain resolution must not trust the Somoco database

The app's Supabase database currently has row-level security disabled and is written
with a public anon key, meaning its approval and resolution records are forgeable by
anyone. That is a known open issue in the app layer. **The contract must never take
resolution input from that database**, directly or via a backend signer that reads
it. Resolution authority is the multisig and nothing else.

### Resolution timeout — required

If the resolver never calls `resolve()`, user funds are locked forever. This is not
an acceptable failure mode.

```solidity
function voidAfterTimeout() external;   // callable by ANYONE
```

- Callable by anyone once `block.timestamp > resolutionDate + RESOLUTION_TIMEOUT`.
- Suggested `RESOLUTION_TIMEOUT`: **30 days**. Long enough for genuine ambiguity,
  short enough that abandonment isn't indefinite.
- Moves the market to `Voided`. Everyone can then reclaim their stake.
- Permissionless by design — the whole point is that it works when Somoco is gone.

---

## 8. Voiding and refunds

```solidity
function void() external onlyResolver;   // outcome impossible/ambiguous
function claim() external;               // payout if Resolved, refund if Voided
```

`Voided` returns every participant exactly their stake, **with zero fee taken**.
Somoco does not earn on a market that didn't happen.

Void is reachable from `Open` or `Locked`, and via `voidAfterTimeout()`.

### Cases that must void automatically at resolution

**One-sided market.** If `poolNo == 0` and YES wins, there are no losers and nothing
to distribute. Do not attempt division by zero, and do not let winners "win" nothing
while paying gas. Resolving a market where the losing pool is empty should return
every winner their stake with no fee. The same applies if the *winning* pool is
empty (everyone was wrong): those funds have no rightful winner — refund all
participants rather than sending the pot to the treasury.

**Empty market.** `poolYes == 0 && poolNo == 0` — resolving is a no-op; allow void.

---

## 9. Relationship to Intuition

v1 does **not** deposit into Intuition's MultiVault.

Intuition's team confirmed (July 2026) that custom bonding curves for resolving
markets would require MultiVault changes and are not a near-term priority, and
recommended handling resolution in a proxy layer instead. Their suggested design had
per-side proxies depositing into the vault as a single voice. v1 deliberately does
not do this: mixing bonding-curve accounting into settlement makes payout amounts
depend on curve movement and vault entry/exit fees, which can leave the winning side
worse off than they started. Keeping the pool as plain held `$TRUST` makes payouts
exact and provable.

The two layers stay cleanly separated:

- **Intuition** — the claim itself (the Triple), conviction signal, reputation.
  Already built and live.
- **This contract** — the money.

The only link is `termId`, stored on the market so the UI can join them.

---

## 10. Decisions Somoco must make before build starts

| # | Decision | Note |
|---|---|---|
| 1 | Who may call `createMarket`? | Admin-only is safest for v1. Permissionless creation means anyone can spin up markets on any claim, including ones Somoco doesn't want to be seen settling. |
| 2 | `lockOffset` default | Suggest 24h before resolution date. Shorter feels better to users; longer is safer against late information. |
| 3 | Minimum stake | Must exceed realistic claim gas cost. |
| 4 | Treasury address for the 3% | Should be a multisig, separate from the resolver. |
| 5 | Resolver multisig signers and threshold | See §7. |
| 6 | **Legal review** | Taking a percentage of a wagering pool is close to the definition of operating a betting exchange in most jurisdictions, including Nigeria. This needs a lawyer's input **before launch**, not after. It is the single highest-consequence open item in this document. |

---

## 11. Security requirements

Non-negotiable for a contract holding user funds:

- **Pull payments.** Users call `claim()` to withdraw. Never loop over participants
  pushing funds — it fails on the first reverting recipient and is a gas-griefing
  vector.
- **Checks-Effects-Interactions** plus a `nonReentrant` guard on `claim()`. Zero the
  user's claimable balance *before* transferring.
- **Idempotent claims.** A second `claim()` must pay nothing and revert cleanly.
- Use `call{value:}` with an explicit success check, not `transfer`/`send`.
- Solvency invariant: the sum of all outstanding claimable amounts plus the unswept
  fee must never exceed the contract balance. Assert this in tests.
- **Clone initialization guard.** EIP-1167 clones have no constructor; `initialize()`
  must be callable exactly once and the implementation contract itself must be
  initialized/disabled so it cannot be hijacked.
- No `selfdestruct`, no `delegatecall` to user-supplied addresses, no upgradeability
  in v1 — an upgradeable market is one where the operator can rewrite the payout
  rules after people have staked.

### Required tests

- Full lifecycle: create → stake both sides → lock → resolve → all parties claim.
- Payout math exactness, including the worked example in §5.
- One-sided market (empty losing pool, and empty winning pool).
- Empty market.
- Stake attempt after lock reverts.
- `resolve()` before lock reverts; double `resolve()` reverts.
- Double `claim()` pays once.
- `voidAfterTimeout()` before timeout reverts; after timeout succeeds from any caller.
- Void refunds are exact and fee-free.
- Reentrancy attempt on `claim()` via a malicious receiver contract.
- Solvency invariant holds after fuzzing arbitrary stake sequences.

### Audit

This must be audited before it holds meaningful real money. The scope is small —
two contracts, no external protocol integration, no upgradeability — which is
deliberate and should keep the cost proportionate. Deploy to Intuition testnet and
run with play amounts first.

---

## 12. What the app already provides

The dev does not need to build any of this; it exists and works:

- Prediction parsing, Triple creation on Intuition, `termId` capture.
- Feed, categories, prediction detail view, admin approval queue.
- Admin resolution flow (currently writes resolution + reputation Triples on-chain
  and a status row in Supabase — this is where `resolve()` gets wired in).
- Wallet connection via Privy, wagmi/viem throughout.

Integration surface is small: call `createMarket` when a prediction is approved,
`stake` from the detail view's YES/NO buttons, `resolve` from the admin resolve
flow, `claim` from My Predictions.
