// Somoco — settlement layer (parimutuel v1)
// Talks to the MarketFactory + PredictionMarket contracts on Intuition mainnet
// (see contracts/ and docs/settlement-v1-spec.md). Each approved prediction MAY
// have a market (created by the admin); users stake native $TRUST on YES/NO,
// the winning side splits the losing pool minus a 3% fee, claims are pulled.
//
// This is deliberately separate from stakeData.ts: that reads Intuition's
// bonding-curve conviction (the claim layer), this reads Somoco's own
// settlement pool (the money layer). The only link is the termId.

import type { Address, Hex, PublicClient, WalletClient } from 'viem'

// v1.2 test deployment 2026-07-22 (adds 40% early-exit unstake) —
// single-EOA roles, redeploy before real launch (contracts/DEPLOYMENTS.md).
// Overridable per-env without a code change.
export const SETTLEMENT_FACTORY: Address =
  (process.env.NEXT_PUBLIC_SETTLEMENT_FACTORY as Address | undefined) ??
  '0xCF1893f255DD8d197f3415411658329d432DaC84'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

export const factoryAbi = [
  {
    type: 'function', name: 'marketForTerm', stateMutability: 'view',
    inputs: [{ name: 'termId', type: 'bytes32' }],
    outputs: [{ type: 'address' }],
  },
  { type: 'function', name: 'marketCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  {
    type: 'function', name: 'allMarkets', stateMutability: 'view',
    inputs: [{ name: 'index', type: 'uint256' }], outputs: [{ type: 'address' }],
  },
  { type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'pendingOwner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'acceptOwnership', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  {
    type: 'function', name: 'createMarket', stateMutability: 'nonpayable',
    inputs: [
      { name: 'termId', type: 'bytes32' },
      { name: 'resolutionDate', type: 'uint64' },
      { name: 'lockOffset', type: 'uint64' },
      { name: 'creator', type: 'address' },
    ],
    outputs: [{ type: 'address' }],
  },
] as const

export const marketAbi = [
  { type: 'function', name: 'termId', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'creator', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'state', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'poolYes', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'poolNo', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'lockAt', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint64' }] },
  { type: 'function', name: 'minStake', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'voided', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'outcome', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  {
    type: 'function', name: 'stakeYes', stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }], outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function', name: 'stakeNo', stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }], outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function', name: 'claimableOf', stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }], outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function', name: 'claimed', stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }], outputs: [{ type: 'bool' }],
  },
  {
    type: 'function', name: 'stake', stateMutability: 'payable',
    inputs: [{ name: 'side', type: 'uint8' }], outputs: [],
  },
  {
    type: 'function', name: 'unstake', stateMutability: 'nonpayable',
    inputs: [{ name: 'side', type: 'uint8' }], outputs: [],
  },
  { type: 'function', name: 'UNSTAKE_PENALTY_BPS', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  {
    type: 'function', name: 'resolve', stateMutability: 'nonpayable',
    inputs: [{ name: 'outcome_', type: 'uint8' }], outputs: [],
  },
  { type: 'function', name: 'claim', stateMutability: 'nonpayable', inputs: [], outputs: [] },
] as const

// Mirrors the contract enums — keep the numbering in sync with PredictionMarket.sol.
export const SIDE = { yes: 0, no: 1 } as const
export const OUTCOME = { unresolved: 0, yes: 1, no: 2 } as const
export type MarketState = 'open' | 'locked' | 'resolved' | 'voided'
const STATES: MarketState[] = ['open', 'locked', 'resolved', 'voided']

export interface MarketInfo {
  address: Address
  state: MarketState
  poolYes: bigint
  poolNo: bigint
  lockAt: number // unix seconds
  minStake: bigint
  outcome: 'unresolved' | 'yes' | 'no'
  // per-connected-user fields; zero when no user given
  myYes: bigint
  myNo: bigint
  claimable: bigint
  claimed: boolean
}

/** The market for a Triple, or null if the admin hasn't created one. */
export async function getMarketAddress(publicClient: PublicClient, termId: Hex): Promise<Address | null> {
  const market = await publicClient.readContract({
    address: SETTLEMENT_FACTORY,
    abi: factoryAbi,
    functionName: 'marketForTerm',
    args: [termId],
  })
  return market === ZERO_ADDRESS ? null : market
}

/** One round-trip snapshot of everything the UI needs about a market. */
export async function readMarketInfo(
  publicClient: PublicClient,
  market: Address,
  user?: Address
): Promise<MarketInfo> {
  const who = user ?? (ZERO_ADDRESS as Address)
  const [state, poolYes, poolNo, lockAt, minStake, outcome, myYes, myNo, claimable, claimed] =
    await Promise.all([
      publicClient.readContract({ address: market, abi: marketAbi, functionName: 'state' }),
      publicClient.readContract({ address: market, abi: marketAbi, functionName: 'poolYes' }),
      publicClient.readContract({ address: market, abi: marketAbi, functionName: 'poolNo' }),
      publicClient.readContract({ address: market, abi: marketAbi, functionName: 'lockAt' }),
      publicClient.readContract({ address: market, abi: marketAbi, functionName: 'minStake' }),
      publicClient.readContract({ address: market, abi: marketAbi, functionName: 'outcome' }),
      publicClient.readContract({ address: market, abi: marketAbi, functionName: 'stakeYes', args: [who] }),
      publicClient.readContract({ address: market, abi: marketAbi, functionName: 'stakeNo', args: [who] }),
      publicClient.readContract({ address: market, abi: marketAbi, functionName: 'claimableOf', args: [who] }),
      publicClient.readContract({ address: market, abi: marketAbi, functionName: 'claimed', args: [who] }),
    ])

  return {
    address: market,
    state: STATES[Number(state)] ?? 'open',
    poolYes, poolNo,
    lockAt: Number(lockAt),
    minStake,
    outcome: state === 3 ? 'unresolved' : outcome === 1 ? 'yes' : outcome === 2 ? 'no' : 'unresolved',
    myYes: user ? myYes : 0n,
    myNo: user ? myNo : 0n,
    claimable: user ? claimable : 0n,
    claimed: user ? claimed : false,
  }
}

/** Lightweight per-term pool snapshot for feed/trending cards. */
export interface TermPools {
  market: Address
  poolYes: bigint
  poolNo: bigint
  state: MarketState
}

/**
 * Batch: settlement pools for many Triples at once (feed + trending cards).
 * Terms without a market are simply absent from the result.
 */
export async function getPoolsForTerms(
  publicClient: PublicClient,
  termIds: Hex[]
): Promise<Record<string, TermPools>> {
  const out: Record<string, TermPools> = {}
  await Promise.all(termIds.map(async termId => {
    try {
      const market = await getMarketAddress(publicClient, termId)
      if (!market) return
      const [poolYes, poolNo, state] = await Promise.all([
        publicClient.readContract({ address: market, abi: marketAbi, functionName: 'poolYes' }),
        publicClient.readContract({ address: market, abi: marketAbi, functionName: 'poolNo' }),
        publicClient.readContract({ address: market, abi: marketAbi, functionName: 'state' }),
      ])
      out[termId] = { market, poolYes, poolNo, state: STATES[Number(state)] ?? 'open' }
    } catch (e) {
      console.error('getPoolsForTerms read error', termId, e)
    }
  }))
  return out
}

/**
 * All termIds the user has a position in, by walking every market on the
 * factory. Fine at current scale (a handful of markets); replace with an
 * indexer/event scan when the market count grows.
 */
export async function getMyStakedTerms(
  publicClient: PublicClient,
  user: Address
): Promise<Hex[]> {
  const count = Number(await publicClient.readContract({
    address: SETTLEMENT_FACTORY, abi: factoryAbi, functionName: 'marketCount',
  }))
  const terms: Hex[] = []
  await Promise.all(Array.from({ length: count }, async (_, i) => {
    try {
      const market = await publicClient.readContract({
        address: SETTLEMENT_FACTORY, abi: factoryAbi, functionName: 'allMarkets', args: [BigInt(i)],
      })
      const [yes, no] = await Promise.all([
        publicClient.readContract({ address: market, abi: marketAbi, functionName: 'stakeYes', args: [user] }),
        publicClient.readContract({ address: market, abi: marketAbi, functionName: 'stakeNo', args: [user] }),
      ])
      if (yes > 0n || no > 0n) {
        terms.push(await publicClient.readContract({ address: market, abi: marketAbi, functionName: 'termId' }))
      }
    } catch (e) {
      console.error('getMyStakedTerms read error', i, e)
    }
  }))
  return terms
}

/** One market the connected wallet has money in — the "your positions" rail row. */
export interface MyPosition {
  termId: Hex
  market: Address
  state: MarketState
  outcome: 'unresolved' | 'yes' | 'no'
  poolYes: bigint
  poolNo: bigint
  /** This wallet's own stake on each side (a wallet can hold both). */
  myYes: bigint
  myNo: bigint
  claimable: bigint
  claimed: boolean
  lockAt: number // unix seconds
}

/**
 * Every market this wallet has a stake in, with the numbers the rail needs to
 * colour a row: both pools (who's ahead), the user's own side, and anything
 * claimable once resolved.
 *
 * Same O(marketCount) factory walk as getMyStakedTerms — two reads per market
 * to test for a position, the rest only for markets the user actually touched.
 * Fine while markets number in the dozens; wants an indexer beyond that.
 */
export async function getMyPositions(
  publicClient: PublicClient,
  user: Address
): Promise<MyPosition[]> {
  const count = Number(await publicClient.readContract({
    address: SETTLEMENT_FACTORY, abi: factoryAbi, functionName: 'marketCount',
  }))
  const positions: MyPosition[] = []
  await Promise.all(Array.from({ length: count }, async (_, i) => {
    try {
      const market = await publicClient.readContract({
        address: SETTLEMENT_FACTORY, abi: factoryAbi, functionName: 'allMarkets', args: [BigInt(i)],
      })
      const [myYes, myNo] = await Promise.all([
        publicClient.readContract({ address: market, abi: marketAbi, functionName: 'stakeYes', args: [user] }),
        publicClient.readContract({ address: market, abi: marketAbi, functionName: 'stakeNo', args: [user] }),
      ])
      if (myYes === 0n && myNo === 0n) return

      const [termId, state, outcome, poolYes, poolNo, lockAt, claimable, claimed] = await Promise.all([
        publicClient.readContract({ address: market, abi: marketAbi, functionName: 'termId' }),
        publicClient.readContract({ address: market, abi: marketAbi, functionName: 'state' }),
        publicClient.readContract({ address: market, abi: marketAbi, functionName: 'outcome' }),
        publicClient.readContract({ address: market, abi: marketAbi, functionName: 'poolYes' }),
        publicClient.readContract({ address: market, abi: marketAbi, functionName: 'poolNo' }),
        publicClient.readContract({ address: market, abi: marketAbi, functionName: 'lockAt' }),
        publicClient.readContract({ address: market, abi: marketAbi, functionName: 'claimableOf', args: [user] }),
        publicClient.readContract({ address: market, abi: marketAbi, functionName: 'claimed', args: [user] }),
      ])

      const marketState = STATES[Number(state)] ?? 'open'
      positions.push({
        termId, market, state: marketState,
        // A voided market has no outcome even though `outcome` may be set.
        outcome: marketState === 'resolved'
          ? (Number(outcome) === 1 ? 'yes' : Number(outcome) === 2 ? 'no' : 'unresolved')
          : 'unresolved',
        poolYes, poolNo, myYes, myNo, claimable, claimed,
        lockAt: Number(lockAt),
      })
    } catch (e) {
      console.error('getMyPositions read error', i, e)
    }
  }))
  return positions
}

/** Factory owner-only: create the settlement market for an approved prediction. */
export async function createMarketOnChain(
  publicClient: PublicClient,
  walletClient: WalletClient,
  termId: Hex,
  resolutionDateUnix: number,
  lockOffsetSeconds: number,
  creator: Address
): Promise<Hex> {
  const [account] = await walletClient.getAddresses()
  const hash = await walletClient.writeContract({
    address: SETTLEMENT_FACTORY,
    abi: factoryAbi,
    functionName: 'createMarket',
    args: [termId, BigInt(resolutionDateUnix), BigInt(lockOffsetSeconds), creator],
    account,
    chain: walletClient.chain,
  })
  await publicClient.waitForTransactionReceipt({ hash })
  return hash
}

/** Pending-owner-only: accept factory ownership (two-step handover). */
export async function acceptFactoryOwnership(
  publicClient: PublicClient,
  walletClient: WalletClient
): Promise<Hex> {
  const [account] = await walletClient.getAddresses()
  const hash = await walletClient.writeContract({
    address: SETTLEMENT_FACTORY,
    abi: factoryAbi,
    functionName: 'acceptOwnership',
    account,
    chain: walletClient.chain,
  })
  await publicClient.waitForTransactionReceipt({ hash })
  return hash
}

/** Who currently owns / is about to own the factory (for admin UI banners). */
export async function getFactoryOwnership(publicClient: PublicClient): Promise<{ owner: Address; pendingOwner: Address }> {
  const [owner, pendingOwner] = await Promise.all([
    publicClient.readContract({ address: SETTLEMENT_FACTORY, abi: factoryAbi, functionName: 'owner' }),
    publicClient.readContract({ address: SETTLEMENT_FACTORY, abi: factoryAbi, functionName: 'pendingOwner' }),
  ])
  return { owner, pendingOwner }
}

/** Stake native $TRUST on a side. Only while the market is open. */
export async function stakeOnMarket(
  publicClient: PublicClient,
  walletClient: WalletClient,
  market: Address,
  side: 'yes' | 'no',
  amountWei: bigint
): Promise<Hex> {
  const [account] = await walletClient.getAddresses()
  const hash = await walletClient.writeContract({
    address: market,
    abi: marketAbi,
    functionName: 'stake',
    args: [SIDE[side]],
    value: amountWei,
    account,
    chain: walletClient.chain,
  })
  await publicClient.waitForTransactionReceipt({ hash })
  return hash
}

/** Early-exit penalty in bps (e.g. 4000 = 40%), constant on the contract. */
export const UNSTAKE_PENALTY_BPS = 4000

/**
 * Exit a position early (before lock), forfeiting `UNSTAKE_PENALTY_BPS`. The
 * whole of the chosen side's stake is withdrawn; the kept portion is returned.
 */
export async function unstakeFromMarket(
  publicClient: PublicClient,
  walletClient: WalletClient,
  market: Address,
  side: 'yes' | 'no'
): Promise<Hex> {
  const [account] = await walletClient.getAddresses()
  const hash = await walletClient.writeContract({
    address: market,
    abi: marketAbi,
    functionName: 'unstake',
    args: [SIDE[side]],
    account,
    chain: walletClient.chain,
  })
  await publicClient.waitForTransactionReceipt({ hash })
  return hash
}

/** Resolver-only: declare the outcome once the market is locked. */
export async function resolveMarket(
  publicClient: PublicClient,
  walletClient: WalletClient,
  market: Address,
  outcome: 'yes' | 'no'
): Promise<Hex> {
  const [account] = await walletClient.getAddresses()
  const hash = await walletClient.writeContract({
    address: market,
    abi: marketAbi,
    functionName: 'resolve',
    args: [OUTCOME[outcome]],
    account,
    chain: walletClient.chain,
  })
  await publicClient.waitForTransactionReceipt({ hash })
  return hash
}

/** Pull your payout (resolved) or refund (voided). */
export async function claimFromMarket(
  publicClient: PublicClient,
  walletClient: WalletClient,
  market: Address
): Promise<Hex> {
  const [account] = await walletClient.getAddresses()
  const hash = await walletClient.writeContract({
    address: market,
    abi: marketAbi,
    functionName: 'claim',
    account,
    chain: walletClient.chain,
  })
  await publicClient.waitForTransactionReceipt({ hash })
  return hash
}
