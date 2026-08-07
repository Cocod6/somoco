'use client'

import { useState, useSyncExternalStore } from 'react'
import WalletButton from '../components/WalletButton'
import { useAccount } from 'wagmi'
import PredictionFeed from '../components/PredictionFeed'
import SubmitPrediction from '../components/SubmitPrediction'
import ExploreAtoms from '../components/ExploreAtoms'
import ResolveAdmin from '../components/ResolveAdmin'
import ApproveAdmin from '../components/ApproveAdmin'
import MyPredictions from '../components/MyPredictions'
import Leaderboard from '../components/Leaderboard'
import Trending from '../components/Trending'
import PredictionDetail from '../components/PredictionDetail'
import AdminGate from '../components/AdminGate'
import SomocoLogo from '../components/SomocoLogo'
import YourRail from '../components/YourRail'
import { useIsAdmin } from '../lib/admin'

type Page = 'feed' | 'trending' | 'explore' | 'submit' | 'my' | 'resolve' | 'approve' | 'leaderboard'

// Hydration detector: false during SSR and the first client paint, true after.
// (useSyncExternalStore's server snapshot vs client snapshot — no effect needed.)
const emptySubscribe = () => () => {}
const useHydrated = () =>
  useSyncExternalStore(emptySubscribe, () => true, () => false)

export default function Home() {
  const [activePage, setActivePage] = useState<Page>('feed')
  // When set, a prediction detail view replaces the active page's content.
  const [detailId, setDetailId] = useState<string | null>(null)
  const { isConnected, address } = useAccount()
  const isAdmin = useIsAdmin()

  // `isAdmin` comes from the connected wallet, which is only known on the
  // client. The server always renders it as false, so revealing admin nav on
  // the first client paint would differ from the server HTML and throw a
  // hydration mismatch. Gate it behind hydration so first paint matches.
  const hydrated = useHydrated()
  const showAdmin = hydrated && isAdmin

  const allNavItems = [
    { id: 'feed', label: 'Prediction feed', icon: '▤', section: 'discover', adminOnly: false },
    { id: 'trending', label: 'Trending', icon: '↑', section: null, adminOnly: false },
    { id: 'leaderboard', label: 'Leaderboard', icon: '★', section: null, adminOnly: false },
    { id: 'explore', label: 'Explore atoms', icon: '◎', section: null, adminOnly: false },
    { id: 'submit', label: 'Submit prediction', icon: '+', section: 'create', adminOnly: false },
    { id: 'my', label: 'My predictions', icon: '◉', section: null, adminOnly: false },
    { id: 'approve', label: 'Approve', icon: '✓', section: 'admin', adminOnly: true },
    { id: 'resolve', label: 'Resolve', icon: '⚖', section: null, adminOnly: true },
  ]
  // Hide admin links from non-admins (the pages guard themselves too).
  const navItems = allNavItems.filter(item => !item.adminOnly || showAdmin)

  // The positions rail is for pages where "what am I holding?" is the natural
  // second question. It would only duplicate the page on My predictions, and
  // it's noise while submitting or moderating.
  const showRail = ['feed', 'trending', 'leaderboard', 'explore'].includes(activePage) || detailId !== null

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Nav */}
      <nav className="app-nav">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <SomocoLogo size={32} />
          <div>
            <div style={{
              fontSize: 18, fontWeight: 800, letterSpacing: '-0.5px',
              background: 'linear-gradient(90deg, #f0ede6 30%, var(--accent))',
              WebkitBackgroundClip: 'text', backgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>somoco</div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginTop: -2 }}>
              on intuition
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="app-nav-chain">intuition mainnet</div>
          <WalletButton />
        </div>
      </nav>

      {/* Body */}
      <div className="app-shell">
        {/* Sidebar */}
        <aside className="app-sidebar">
          {navItems.map(item => (
            <div key={item.id}>
              {item.section && <div className="nav-section">{item.section}</div>}
              <div
                onClick={() => { setActivePage(item.id as Page); setDetailId(null) }}
                className={`nav-item${activePage === item.id ? ' active' : ''}`}
              >
                <span style={{ fontSize: 16 }}>{item.icon}</span>
                {item.label}
              </div>
            </div>
          ))}

          <div className="nav-section">protocol</div>
          <a href="https://portal.intuition.systems" target="_blank" rel="noopener noreferrer" className="nav-item">
            <span>↗</span> Intuition portal
          </a>
          <a href="https://intuition.box/docs" target="_blank" rel="noopener noreferrer" className="nav-item">
            <span>↗</span> Docs
          </a>
        </aside>

        {/* Main content + the user's own positions */}
        <div className="app-content">
          <main className="app-main">
            {detailId ? (
              <PredictionDetail predictionId={detailId} onBack={() => setDetailId(null)} />
            ) : (
              <>
                {activePage === 'feed' && <PredictionFeed onSubmit={() => setActivePage('submit')} onOpen={setDetailId} />}
                {activePage === 'submit' && <SubmitPrediction isConnected={isConnected} address={address} />}
                {activePage === 'explore' && <ExploreAtoms />}
                {activePage === 'resolve' && (
                  <AdminGate title="resolve predictions">
                    <ResolveAdmin isConnected={isConnected} />
                  </AdminGate>
                )}
                {activePage === 'approve' && (
                  <AdminGate title="approve predictions">
                    <ApproveAdmin />
                  </AdminGate>
                )}
                {activePage === 'my' && <MyPredictions isConnected={isConnected} address={address} onOpen={setDetailId} />}
                {activePage === 'leaderboard' && <Leaderboard />}
                {activePage === 'trending' && <Trending onOpen={setDetailId} />}
              </>
            )}
          </main>

          {showRail && (
            <aside className="app-rail">
              <YourRail
                isConnected={isConnected}
                address={address}
                onOpen={id => { setDetailId(id); setActivePage('feed') }}
              />
            </aside>
          )}
        </div>
      </div>
    </div>
  )
}
