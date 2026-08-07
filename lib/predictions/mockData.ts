// Somoco — Phase 3: mock predictions for testing the resolution flow
// These stand in for real on-chain predictions until the parser + on-chain
// submission are wired up. Once that's done, this file gets swapped for a
// real fetch from Intuition.

export interface MockPrediction {
  id: string
  subject: string
  claim: string
  condition: string
  resolutionDate: string // ISO date, YYYY-MM-DD
  creator: string // wallet address, shortened for display
  status: 'pending' | 'resolved_true' | 'resolved_false'
}

export const mockPredictions: MockPrediction[] = [
  {
    id: 'pred-001',
    subject: 'Bitcoin',
    claim: 'reaches $150K',
    condition: 'before December 2026',
    resolutionDate: '2026-06-15', // overdue
    creator: '0x7a2f...e91c',
    status: 'pending',
  },
  {
    id: 'pred-002',
    subject: 'Injective',
    claim: 'crosses $50',
    condition: 'before end of Q3 2026',
    resolutionDate: '2026-06-20', // due today
    creator: '0x3b9d...4a17',
    status: 'pending',
  },
  {
    id: 'pred-003',
    subject: 'Arsenal FC',
    claim: 'wins the Premier League',
    condition: '2026/2027 season',
    resolutionDate: '2027-05-25', // far future
    creator: '0x91ee...2c08',
    status: 'pending',
  },
  {
    id: 'pred-004',
    subject: 'Ethereum',
    claim: 'flips Bitcoin in market cap',
    condition: 'before 2027',
    resolutionDate: '2026-06-10', // overdue
    creator: '0x7a2f...e91c',
    status: 'pending',
  },
]
