// Somoco — friend markets (the jury layer)
//
// A friend market is an ordinary PredictionMarket whose OUTCOME is decided by
// the people who bet in it, not by Somoco. That works because the market only
// ever asks whether the caller is `factory.resolver()`, and the resolver is
// allowed to be a contract. FriendJury is that contract — see
// docs/friend-markets-v1-spec.md and contracts/src/FriendJury.sol.
//
// Everything here is a no-op until FriendJury actually holds the resolver role
// on the live factory; `juryIsLive()` is the switch the UI checks, and it reads
// the chain rather than trusting an env var, so there is no state to keep in
// sync during the handover.

import type { Address, Hex, PublicClient, WalletClient } from 'viem'
import { SETTLEMENT_FACTORY, factoryAbi, getMarketAddress, readMarketInfo, type MarketState } from './settlement'

/** Deployed FriendJury. Empty until the contract is deployed (see below). */
export const FRIEND_JURY: Address =
  (process.env.NEXT_PUBLIC_FRIEND_JURY as Address | undefined) ??
  '0x0000000000000000000000000000000000000000'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/** Matches PredictionMarket.Outcome on-chain. */
export const OUTCOME = { unresolved: 0, yes: 1, no: 2 } as const
export type VoteOutcome = 1 | 2

export const friendJuryAbi = [
  {
    type: 'function', name: 'registerJury', stateMutability: 'nonpayable',
    inputs: [
      { name: 'market', type: 'address' },
      { name: 'voters_', type: 'address[]' },
      { name: 'judge_', type: 'address' },
      { name: 'voteWindow', type: 'uint64' },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'castVote', stateMutability: 'nonpayable',
    inputs: [{ name: 'market', type: 'address' }, { name: 'outcome', type: 'uint8' }],
    outputs: [],
  },
  {
    type: 'function', name: 'judgeResolve', stateMutability: 'nonpayable',
    inputs: [{ name: 'market', type: 'address' }, { name: 'outcome', type: 'uint8' }],
    outputs: [],
  },
  {
    type: 'function', name: 'adminResolve', stateMutability: 'nonpayable',
    inputs: [{ name: 'market', type: 'address' }, { name: 'outcome', type: 'uint8' }],
    outputs: [],
  },
  {
    type: 'function', name: 'adminVoid', stateMutability: 'nonpayable',
    inputs: [{ name: 'market', type: 'address' }],
    outputs: [],
  },
  {
    type: 'function', name: 'status', stateMutability: 'view',
    inputs: [{ name: 'market', type: 'address' }],
    outputs: [
      {
        name: 'jury', type: 'tuple',
        components: [
          { name: 'judge', type: 'address' },
          { name: 'opensAt', type: 'uint64' },
          { name: 'judgeFrom', type: 'uint64' },
          { name: 'voterCount', type: 'uint8' },
          { name: 'votesCast', type: 'uint8' },
          { name: 'votesYes', type: 'uint8' },
          { name: 'votesNo', type: 'uint8' },
          { name: 'finalized', type: 'bool' },
        ],
      },
      { name: 'registered', type: 'bool' },
      { name: 'disputed', type: 'bool' },
      { name: 'judgeCanActNow', type: 'bool' },
    ],
  },
  {
    type: 'function', name: 'votersOf', stateMutability: 'view',
    inputs: [{ name: 'market', type: 'address' }],
    outputs: [{ type: 'address[]' }],
  },
  {
    type: 'function', name: 'isVoter', stateMutability: 'view',
    inputs: [{ name: 'market', type: 'address' }, { name: 'voter', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function', name: 'voteOf', stateMutability: 'view',
    inputs: [{ name: 'market', type: 'address' }, { name: 'voter', type: 'address' }],
    outputs: [{ type: 'uint8' }],
  },
  { type: 'function', name: 'acceptResolverRole', stateMutability: 'nonpayable', inputs: [], outputs: [] },
] as const

export interface JuryStatus {
  judge: Address
  /** Voting opens here (unix seconds) — the market's own resolution date. */
  opensAt: number
  /** From here the judge may rule even without a dispute (unix seconds). */
  judgeFrom: number
  voterCount: number
  votesCast: number
  votesYes: number
  votesNo: number
  /** The jury has already settled this market. */
  finalized: boolean
  /** Votes cast so far point both ways. */
  disputed: boolean
  judgeCanActNow: boolean
  /** Everyone invited, in the order they were registered. */
  voters: Address[]
  /** The connected wallet's vote: 0 = not voted, 1 = YES, 2 = NO. */
  myVote: number
  /** Whether the connected wallet is one of the invited voters. */
  iAmVoter: boolean
  iAmJudge: boolean
}

export function juryConfigured(): boolean {
  return FRIEND_JURY !== ZERO_ADDRESS
}

/**
 * Is the jury actually in charge? True only once the factory's resolver role
 * has been handed to the deployed FriendJury. Read from the chain on purpose:
 * during the handover the answer changes without any deploy of ours.
 */
export async function juryIsLive(publicClient: PublicClient): Promise<boolean> {
  if (!juryConfigured()) return false
  try {
    const resolver = await publicClient.readContract({
      address: SETTLEMENT_FACTORY, abi: factoryAbi, functionName: 'resolver',
    }) as Address
    return resolver.toLowerCase() === FRIEND_JURY.toLowerCase()
  } catch (e) {
    console.error('juryIsLive read error', e)
    return false
  }
}

/**
 * Full jury state for one market, or null if it has no jury (the ordinary
 * case — most markets are public and Somoco-resolved).
 */
export async function readJuryStatus(
  publicClient: PublicClient,
  market: Address,
  viewer?: Address
): Promise<JuryStatus | null> {
  if (!juryConfigured()) return null
  try {
    const [jury, registered, disputed, judgeCanActNow] = await publicClient.readContract({
      address: FRIEND_JURY, abi: friendJuryAbi, functionName: 'status', args: [market],
    }) as [
      { judge: Address; opensAt: bigint; judgeFrom: bigint; voterCount: number;
        votesCast: number; votesYes: number; votesNo: number; finalized: boolean },
      boolean, boolean, boolean,
    ]
    if (!registered) return null

    const voters = await publicClient.readContract({
      address: FRIEND_JURY, abi: friendJuryAbi, functionName: 'votersOf', args: [market],
    }) as Address[]

    let myVote = 0
    let iAmVoter = false
    if (viewer) {
      const [vote, isV] = await Promise.all([
        publicClient.readContract({
          address: FRIEND_JURY, abi: friendJuryAbi, functionName: 'voteOf', args: [market, viewer],
        }) as Promise<number>,
        publicClient.readContract({
          address: FRIEND_JURY, abi: friendJuryAbi, functionName: 'isVoter', args: [market, viewer],
        }) as Promise<boolean>,
      ])
      myVote = Number(vote)
      iAmVoter = isV
    }

    return {
      judge: jury.judge,
      opensAt: Number(jury.opensAt),
      judgeFrom: Number(jury.judgeFrom),
      voterCount: Number(jury.voterCount),
      votesCast: Number(jury.votesCast),
      votesYes: Number(jury.votesYes),
      votesNo: Number(jury.votesNo),
      finalized: jury.finalized,
      disputed,
      judgeCanActNow,
      voters,
      myVote,
      iAmVoter,
      iAmJudge: !!viewer && jury.judge.toLowerCase() === viewer.toLowerCase(),
    }
  } catch (e) {
    console.error('readJuryStatus error', e)
    return null
  }
}

/**
 * Who decides this prediction, read from the chain. The Resolve page and
 * /api/admin/resolve both ask this before Somoco records an outcome, because a
 * friend market's result belongs to its jury: Somoco writing its own verdict
 * would put a public claim on Intuition that the contract then refuses.
 *
 *   none       — no pool, or a pool without a jury: Somoco resolves it as usual
 *   jury       — the friends (or their judge) decide; Somoco may only void
 *   unreadable — the chain could not be read; callers must fail CLOSED
 *
 * Unlike readJuryStatus this does not turn a failed read into "no jury" —
 * that is exactly the confusion that would let a verdict through.
 */
export type JuryView =
  | { kind: 'none' }
  | { kind: 'unreadable'; reason: string }
  | {
      kind: 'jury'
      market: Address
      jury: Pick<JuryStatus, 'judge' | 'opensAt' | 'judgeFrom' | 'voterCount' | 'votesCast' | 'votesYes' | 'votesNo' | 'finalized' | 'disputed' | 'judgeCanActNow'>
      marketState: MarketState
      /** What the market settled on. 'unresolved' until it is final (and after a void). */
      marketOutcome: 'unresolved' | 'yes' | 'no'
    }

export async function readJuryView(publicClient: PublicClient, tripleId: Hex): Promise<JuryView> {
  if (!juryConfigured()) return { kind: 'none' }
  try {
    const market = await getMarketAddress(publicClient, tripleId)
    if (!market) return { kind: 'none' }

    const [[jury, registered, disputed, judgeCanActNow], info] = await Promise.all([
      publicClient.readContract({
        address: FRIEND_JURY, abi: friendJuryAbi, functionName: 'status', args: [market],
      }) as Promise<[
        { judge: Address; opensAt: bigint; judgeFrom: bigint; voterCount: number;
          votesCast: number; votesYes: number; votesNo: number; finalized: boolean },
        boolean, boolean, boolean,
      ]>,
      readMarketInfo(publicClient, market),
    ])
    if (!registered) return { kind: 'none' }

    return {
      kind: 'jury',
      market,
      jury: {
        judge: jury.judge,
        opensAt: Number(jury.opensAt),
        judgeFrom: Number(jury.judgeFrom),
        voterCount: Number(jury.voterCount),
        votesCast: Number(jury.votesCast),
        votesYes: Number(jury.votesYes),
        votesNo: Number(jury.votesNo),
        finalized: jury.finalized,
        disputed,
        judgeCanActNow,
      },
      marketState: info.state,
      marketOutcome: info.outcome,
    }
  } catch (e) {
    return { kind: 'unreadable', reason: e instanceof Error ? e.message.split('\n')[0] : String(e) }
  }
}

/**
 * Whether Somoco may record `outcome` for a prediction, given its jury view.
 * Returns a reason to refuse, or null. For a friend market the only outcome
 * Somoco may record is the one the contract already holds, and an unreadable
 * chain refuses everything (fails closed). Used by /api/admin/resolve.
 */
export function juryRecordRefusal(
  view: JuryView,
  outcome: 'resolved_true' | 'resolved_false' | 'voided'
): string | null {
  if (view.kind === 'none') return null
  if (view.kind === 'unreadable') {
    return `This is a friend market and its jury could not be read from the chain (${view.reason}). Nothing was recorded — try again.`
  }

  if (outcome === 'voided') {
    return view.marketState === 'voided'
      ? null
      : 'This friend market has not been voided on-chain, so it cannot be recorded as voided.'
  }

  const want = outcome === 'resolved_true' ? 'yes' : 'no'
  if (view.marketState !== 'resolved') {
    return 'This is a friend market — the friends who bet in it (or their judge) decide the outcome, not Somoco. It has not been settled on-chain yet.'
  }
  if (view.marketOutcome !== want) {
    return `The friends settled this market ${view.marketOutcome.toUpperCase()} on-chain, so it cannot be recorded as ${want.toUpperCase()}.`
  }
  return null
}

/** Cast your vote on what actually happened. One each, unchangeable. */
export async function castVote(
  publicClient: PublicClient,
  walletClient: WalletClient,
  market: Address,
  outcome: VoteOutcome
): Promise<Hex> {
  const [account] = await walletClient.getAddresses()
  const hash = await walletClient.writeContract({
    address: FRIEND_JURY, abi: friendJuryAbi, functionName: 'castVote',
    args: [market, outcome], account, chain: walletClient.chain,
  })
  await publicClient.waitForTransactionReceipt({ hash })
  return hash
}

/** The judge's ruling — allowed once the vote is split, or after the window. */
export async function judgeResolve(
  publicClient: PublicClient,
  walletClient: WalletClient,
  market: Address,
  outcome: VoteOutcome
): Promise<Hex> {
  const [account] = await walletClient.getAddresses()
  const hash = await walletClient.writeContract({
    address: FRIEND_JURY, abi: friendJuryAbi, functionName: 'judgeResolve',
    args: [market, outcome], account, chain: walletClient.chain,
  })
  await publicClient.waitForTransactionReceipt({ hash })
  return hash
}

/** Admin: turn a freshly created market into a friend market. */
export async function registerJury(
  publicClient: PublicClient,
  walletClient: WalletClient,
  market: Address,
  voters: Address[],
  judge: Address,
  voteWindowSeconds: number
): Promise<Hex> {
  const [account] = await walletClient.getAddresses()
  const hash = await walletClient.writeContract({
    address: FRIEND_JURY, abi: friendJuryAbi, functionName: 'registerJury',
    args: [market, voters, judge, BigInt(voteWindowSeconds)],
    account, chain: walletClient.chain,
  })
  await publicClient.waitForTransactionReceipt({ hash })
  return hash
}

/**
 * Resolve an ordinary (non-friend) market through the jury contract.
 * Used by the admin resolve flow whenever the jury holds the resolver role —
 * the market itself will only accept a call from the current resolver, so once
 * the handover happens the direct `market.resolve()` path stops working.
 */
export async function adminResolveViaJury(
  publicClient: PublicClient,
  walletClient: WalletClient,
  market: Address,
  outcome: VoteOutcome
): Promise<Hex> {
  const [account] = await walletClient.getAddresses()
  const hash = await walletClient.writeContract({
    address: FRIEND_JURY, abi: friendJuryAbi, functionName: 'adminResolve',
    args: [market, outcome], account, chain: walletClient.chain,
  })
  await publicClient.waitForTransactionReceipt({ hash })
  return hash
}

export const VOTE_WINDOW_PRESETS = [
  { label: '24 hours', seconds: 24 * 60 * 60 },
  { label: '3 days', seconds: 3 * 24 * 60 * 60 },
  { label: '7 days', seconds: 7 * 24 * 60 * 60 },
] as const

/** Contract bounds, mirrored for client-side validation. */
export const MAX_VOTERS = 20
export const MIN_VOTE_WINDOW_SECONDS = 60 * 60
export const MAX_VOTE_WINDOW_SECONDS = 21 * 24 * 60 * 60
