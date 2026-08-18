'use client'

import Link from 'next/link'
import SomocoLogo from './SomocoLogo'
import { SETTLEMENT_FACTORY } from '../lib/predictions/settlement'
import { intuition } from '../lib/chain'

// The pages the footer can send you to. Kept as a loose string so this file
// doesn't have to import the Page union out of app/page.tsx (which is a client
// component with the whole app in its import graph) — page.tsx narrows it.
type NavTarget = string

/**
 * onNavigate is optional on purpose. The app itself is a single page whose
 * "routes" are React state, so only app/page.tsx can switch them — a standalone
 * route like /terms has no such state to change. Given no handler, the footer
 * drops the in-app columns rather than rendering links that can't work, and the
 * standalone page carries its own "back to somoco" link instead.
 */
export default function SiteFooter({ onNavigate }: { onNavigate?: (page: NavTarget) => void }) {
  const explorer = intuition.blockExplorers.default.url

  // In-app destinations. These are SPA state changes, not URLs, so they're
  // buttons — a bare <a href="#"> would tell a screen reader it navigates
  // somewhere and would blow away the page state on middle-click.
  const columns: { head: string; items: { label: string; page: NavTarget }[] }[] = [
    {
      head: 'explore',
      items: [
        { label: 'Prediction feed', page: 'feed' },
        { label: 'Trending', page: 'trending' },
        { label: 'Leaderboard', page: 'leaderboard' },
        { label: 'Explore atoms', page: 'explore' },
      ],
    },
    {
      head: 'participate',
      items: [
        { label: 'Submit a prediction', page: 'submit' },
        { label: 'PVP markets', page: 'pvp' },
        { label: 'My predictions', page: 'my' },
      ],
    },
  ]

  // Everything that lives outside somoco. Moved here from the sidebar's
  // "protocol" section — they're reference material, not navigation you reach
  // for mid-session, and the rail is worth more to the pages people use.
  const external: { label: string; href: string }[] = [
    { label: 'Intuition portal', href: 'https://portal.intuition.systems' },
    { label: 'Intuition docs', href: 'https://intuition.box/docs' },
    { label: 'Block explorer', href: explorer },
    { label: 'Settlement contract', href: `${explorer}/address/${SETTLEMENT_FACTORY}` },
    { label: 'somoco on X', href: 'https://x.com/somoco_app' },
  ]

  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <SomocoLogo size={28} />
            <span className="footer-wordmark">somoco</span>
          </div>
          <p className="footer-tagline">
            Say what you think will happen. Somoco writes it permanently to the
            Intuition protocol, where anyone can stake $TRUST for or against it.
          </p>
          <div className="footer-chain">
            <span className="footer-dot" />
            {intuition.name} mainnet · chain {intuition.id} · ${intuition.nativeCurrency.symbol}
          </div>
        </div>

        {onNavigate && columns.map(col => (
          <nav key={col.head} className="footer-col" aria-label={col.head}>
            <div className="footer-head">{col.head}</div>
            {col.items.map(item => (
              <button
                key={item.page}
                type="button"
                className="footer-link"
                onClick={() => onNavigate(item.page)}
              >
                {item.label}
              </button>
            ))}
          </nav>
        ))}

        <nav className="footer-col" aria-label="protocol">
          <div className="footer-head">protocol</div>
          {external.map(link => (
            <a
              key={link.label}
              className="footer-link"
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {link.label}
              <span className="footer-ext" aria-hidden="true">↗</span>
            </a>
          ))}
        </nav>

        <nav className="footer-col" aria-label="legal">
          <div className="footer-head">legal</div>
          <Link className="footer-link" href="/terms">Terms of use</Link>
          <Link className="footer-link" href="/terms#risk">Risk disclosure</Link>
          <Link className="footer-link" href="/terms#privacy">Privacy</Link>
        </nav>
      </div>

      <div className="footer-bottom">
        <div>© {new Date().getFullYear()} somoco</div>
        <div className="footer-risk">
          Predictions settle with real $TRUST. Stakes are at risk and are not refundable
          once a market locks. Nothing here is financial advice.
        </div>
      </div>
    </footer>
  )
}
