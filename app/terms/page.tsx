import type { Metadata } from 'next'
import Link from 'next/link'
import SomocoLogo from '../../components/SomocoLogo'
import SiteFooter from '../../components/SiteFooter'

export const metadata: Metadata = {
  title: 'Terms of use — somoco',
  description:
    'The terms you agree to when you use somoco: eligibility, how markets settle, fees, risks, privacy, and what somoco does and does not promise.',
}

// The date the current wording took effect. Deliberately a literal, not a
// computed value: a legal document has to say when it last changed, and a live
// date would silently claim today’s version every day.
const EFFECTIVE = '11 August 2026'

const SECTIONS: { id: string; title: string }[] = [
  { id: 'about', title: '1. What somoco is' },
  { id: 'agreement', title: '2. Agreeing to these terms' },
  { id: 'eligibility', title: '3. Who may use somoco' },
  { id: 'wallet', title: '4. Your wallet' },
  { id: 'predictions', title: '5. Submitting a prediction' },
  { id: 'permanence', title: '6. What is permanent' },
  { id: 'markets', title: '7. Markets and staking' },
  { id: 'fees', title: '8. Fees' },
  { id: 'resolution', title: '9. How markets are resolved' },
  { id: 'risk', title: '10. Risk disclosure' },
  { id: 'conduct', title: '11. Acceptable use' },
  { id: 'content', title: '12. Your content and moderation' },
  { id: 'ip', title: '13. Intellectual property' },
  { id: 'privacy', title: '14. Privacy and data' },
  { id: 'availability', title: '15. Availability and changes' },
  { id: 'disclaimers', title: '16. Disclaimers' },
  { id: 'liability', title: '17. Limitation of liability' },
  { id: 'indemnity', title: '18. Indemnity' },
  { id: 'law', title: '19. Governing law and disputes' },
  { id: 'contact', title: '20. Changes and contact' },
]

/** A blank the operator must fill in before launch. */
function Blank({ children }: { children: React.ReactNode }) {
  return <span className="legal-blank">[{children}]</span>
}

export default function TermsPage() {
  return (
    <div className="legal-shell">
      <nav className="legal-nav">
        <Link href="/" className="legal-back" aria-label="Back to somoco">
          <SomocoLogo size={26} />
          <span>← back to somoco</span>
        </Link>
        <span className="legal-back" style={{ pointerEvents: 'none' }}>terms of use</span>
      </nav>

      <div className="legal-wrap">
        <h1 className="legal-title">Terms of use</h1>
        <div className="legal-meta">effective {EFFECTIVE} · version 1.0</div>

        <p className="legal-lede">
          Somoco lets you write a prediction to a public blockchain and stake real money on
          whether it comes true. That means real risk. These terms explain what somoco does,
          what it does not do, what you are agreeing to, and what happens when things go
          wrong. They are written to be read, not to be skipped — please actually read them.
        </p>

        <nav className="legal-toc" aria-label="Contents">
          {SECTIONS.map(s => (
            <a key={s.id} href={`#${s.id}`}>{s.title}</a>
          ))}
        </nav>

        <section className="legal-section" id="about">
          <h2 className="legal-h2">1. What somoco is</h2>
          <p>
            Somoco is an interface to public smart contracts on the Intuition blockchain
            (chain 1155, native token $TRUST). You type a prediction in plain English. Somoco
            uses AI to turn it into a structured claim, writes that claim permanently to the
            Intuition protocol, and — once approved — opens a market where anyone can stake
            $TRUST for or against it. When the outcome is known, the market is resolved and
            the winning side splits the losing side’s stakes.
          </p>
          <p>
            Somoco is <strong>not</strong> a bank, broker, exchange, custodian, investment
            adviser, or money transmitter. It never holds your funds. Your stakes sit in the
            smart contract, not in a somoco account, and somoco cannot move them for you.
          </p>
          <p>
            In these terms, “somoco”, “we” and “us” mean{' '}
            <Blank>OPERATOR LEGAL NAME</Blank>, the operator of the somoco interface. “You”
            means anyone who uses it.
          </p>
        </section>

        <section className="legal-section" id="agreement">
          <h2 className="legal-h2">2. Agreeing to these terms</h2>
          <p>
            By connecting a wallet, submitting a prediction, or staking on a market, you agree
            to these terms. If you do not agree, do not use somoco.
          </p>
          <p>
            These terms cover the somoco interface — the website and the tooling behind it.
            The Intuition blockchain, the wallets you connect, and any third-party service you
            reach from somoco are run by other people under their own terms, and we are not
            responsible for them.
          </p>
        </section>

        <section className="legal-section" id="eligibility">
          <h2 className="legal-h2">3. Who may use somoco</h2>
          <p>You may use somoco only if all of the following are true:</p>
          <ul>
            <li>You are at least <strong>18 years old</strong> and have the legal capacity to enter this agreement.</li>
            <li>
              You are not located in, resident in, or acting on behalf of anyone in a country
              or territory subject to comprehensive sanctions, and you are not on any
              sanctions or restricted-party list (including those maintained by the United
              Nations, the United States, the United Kingdom, or the European Union).
            </li>
            <li>You are using somoco for yourself, not on behalf of an undisclosed third party.</li>
            <li>Using somoco is lawful where you are.</li>
          </ul>
          <div className="legal-callout">
            <p>
              <strong>That last point is on you.</strong> Staking on the outcome of future
              events is regulated differently in every country, and in some places it is
              restricted or illegal. Somoco does not check where you are and does not give
              you legal advice. Before you stake anything, satisfy yourself that it is legal
              for you — if it is not, you must not use somoco.
            </p>
          </div>
          <p>
            We may refuse access to anyone, at any time, including by blocking wallet
            addresses, without giving a reason.
          </p>
        </section>

        <section className="legal-section" id="wallet">
          <h2 className="legal-h2">4. Your wallet</h2>
          <p>
            Somoco is non-custodial. You connect your own wallet, you approve every
            transaction yourself, and you keep your own keys. We never have access to your
            private keys or recovery phrase, and we can never move, freeze, or recover your
            funds.
          </p>
          <p>
            Wallet connection and optional email login are provided by Privy. If you use a
            Privy embedded wallet, that wallet is still yours and is governed by Privy’s own
            terms. Keeping your wallet, device, and login secure is your responsibility.
          </p>
          <div className="legal-callout">
            <p>
              <strong>Blockchain transactions cannot be undone.</strong> If you send to the
              wrong address, stake on the wrong side, lose your keys, sign a malicious
              transaction, or are the victim of a phishing site pretending to be somoco, the
              funds are gone. There is no support desk that can reverse it, and no chargeback.
            </p>
          </div>
        </section>

        <section className="legal-section" id="predictions">
          <h2 className="legal-h2">5. Submitting a prediction</h2>
          <p>When you submit a prediction, this is what happens:</p>
          <ul>
            <li>
              <strong>AI parsing.</strong> Your text is sent to a third-party AI provider
              (currently Anthropic) which turns it into a structured claim — a subject, a
              claim, and a deadline — plus a suggested plan for how it should be resolved. AI
              output can be wrong. You are shown the parsed result and it is your job to check
              it before confirming.
            </li>
            <li>
              <strong>On-chain write.</strong> When you confirm, your wallet signs a
              transaction that writes the claim to the Intuition protocol as public,
              permanent data.
            </li>
            <li>
              <strong>Review.</strong> Somoco then reviews the prediction before it appears in
              the feed. We may approve it, reject it, or leave it pending, at our discretion.
            </li>
            <li>
              <strong>Market creation.</strong> If it is approved and has a future resolution
              date, somoco may create a settlement market for it.
            </li>
          </ul>
          <div className="legal-callout">
            <p>
              <strong>Review happens after the on-chain write, not before.</strong> If we
              reject your prediction, it simply never appears in somoco — but the claim you
              already signed stays on the Intuition blockchain forever, publicly readable, and
              neither you nor we can delete it. Do not submit anything you would not want
              permanently attached to your wallet address.
            </p>
          </div>
          <p>
            Approval means the prediction met our basic bar for clarity and acceptability. It
            is <strong>not</strong> a statement that the prediction is true, likely, fair, or
            worth staking on, and it is not an endorsement of whoever wrote it.
          </p>
          <p>
            Somoco may require a minimum on-chain reputation score before you can submit, and
            may change that threshold at any time. Somoco also publishes some markets that
            mirror public markets from other platforms; those are marked in the interface.
          </p>
        </section>

        <section className="legal-section" id="permanence">
          <h2 className="legal-h2">6. What is permanent</h2>
          <p>
            Two different things are stored, and only one of them can ever be changed:
          </p>
          <ul>
            <li>
              <strong>On the Intuition blockchain — permanent and public.</strong> Your
              claims, your resolutions, your reputation records, your stakes, and your wallet
              address. Anyone in the world can read these, forever, whether or not they use
              somoco. We cannot edit or erase them, and neither can you. If you ask us to
              delete your data, this part is beyond our reach.
            </li>
            <li>
              <strong>In somoco’s own database — changeable.</strong> Approval status,
              categories, images, resolution notes. This we can edit or delete.
            </li>
          </ul>
          <p>
            Somoco may stop displaying anything at any time. That removes it from the
            interface. It does not remove it from the blockchain.
          </p>
        </section>

        <section className="legal-section" id="markets">
          <h2 className="legal-h2">7. Markets and staking</h2>
          <p>
            A somoco market is a <strong>parimutuel pool</strong>. It is not a share market
            and there is no order book. Everyone staking YES pays into one pool and everyone
            staking NO pays into the other. When the market resolves, the winning side gets
            their own stake back plus a proportional share of the losing pool, after fees.
            Your share is proportional to what you staked relative to the rest of your side.
          </p>
          <h3 className="legal-h3">Odds are not a promise</h3>
          <p>
            The percentages shown while a market is open reflect the money staked at that
            moment. They move as other people stake, so the return you see when you commit is
            not the return you will get.
          </p>
          <h3 className="legal-h3">Locking</h3>
          <p>
            Every market locks at a time fixed when it is created, before its resolution date.
            After lock, no one can stake, and no one can exit. Locking happens by time — it
            needs no action from us, and nothing can hold it open for you.
          </p>
          <h3 className="legal-h3">Leaving early</h3>
          <p>
            While a market is still open you may exit your position in full. You keep{' '}
            <strong>60%</strong> of what you staked; the other <strong>40%</strong> is
            forfeited and added to whichever side eventually wins. Partial exits are not
            supported, and once the market locks, exiting is impossible.
          </p>
          <h3 className="legal-h3">Getting paid</h3>
          <p>
            Payouts are not pushed to you. After a market resolves you must claim your winnings
            yourself, from a transaction you sign. Unclaimed funds stay in the contract.
          </p>
          <h3 className="legal-h3">Voided markets</h3>
          <p>
            A market is voided if nobody staked on the winning side, and anyone at all may
            void it if it has still not been resolved 30 days after its resolution date. When
            a market is voided, everyone claims their own stake back and no fee is taken —
            except that stake forfeited by exiting early is not returned.
          </p>
          <p>
            If money is still unclaimed <strong>180 days</strong> after a market becomes
            final, it may be swept to the somoco treasury. Claim your winnings.
          </p>
        </section>

        <section className="legal-section" id="fees">
          <h2 className="legal-h2">8. Fees</h2>
          <ul>
            <li>
              <strong>3% of the losing pool</strong> is taken as somoco’s fee when a market
              resolves. It is charged on winnings only — never on the stake a winner gets
              back, and never at all on a voided market. Part of it may go to the person whose
              prediction created the market.
            </li>
            <li>
              <strong>40% of your stake</strong> is forfeited if you exit a position before
              lock. This is not a somoco fee: it goes to the winning side, not to us.
            </li>
            <li>
              <strong>Network gas.</strong> Every transaction costs $TRUST paid to the
              Intuition network. That is never paid to somoco and is never refundable, even if
              your transaction fails.
            </li>
          </ul>
          <p>
            The fee rate is fixed in the deployed smart contract at 3% and cannot be raised
            for a market that already exists. Fees for future markets may change; the terms in
            force are always the ones in the contract for that market.
          </p>
          <p>
            Taxes are yours. Somoco does not withhold tax, does not report on your behalf, and
            gives no tax advice.
          </p>
        </section>

        <section className="legal-section" id="resolution">
          <h2 className="legal-h2">9. How markets are resolved</h2>
          <p>
            Most predictions carry a resolution plan describing the sources and criteria that
            decide the outcome. Where a market mirrors a public market from another platform,
            somoco resolves it mechanically by reading that platform’s published result.
            Everything else is resolved by somoco’s resolver, exercising judgment against the
            stated plan.
          </p>
          <div className="legal-callout">
            <p>
              <strong>Somoco decides the outcome, and that decision is final.</strong> There
              is no dispute process, no appeal, and no arbitration over a resolution. We
              resolve honestly and in line with the stated plan, but we are human, sources
              disagree, real events are ambiguous, and we can get it wrong. If you are not
              comfortable with that, do not stake.
            </p>
          </div>
          <p>
            We may void a market instead of resolving it — for example if the outcome is
            genuinely undeterminable, the wording is ambiguous, the resolution source
            disappears, or the market was manipulated. We are not obliged to resolve any
            market by any deadline, though the 30-day timeout in section 7 means funds can
            never be locked up indefinitely.
          </p>
          <p>
            Once a resolution is written on-chain it cannot be reversed, including if it was
            wrong.
          </p>
          <h3 className="legal-h3">Friend markets are different</h3>
          <p>
            A private “friend market” is settled by the people invited to it, not by somoco.
            Everyone invited votes on what happened; if they all agree it settles on that
            outcome automatically, and if they disagree — or someone does not vote in time —
            the judge named when the market was created decides. Somoco has no power to
            declare the outcome of one of these markets and cannot overrule the group or the
            judge.
          </p>
          <p>
            That means the accuracy and good faith of the result is entirely down to the
            people you chose. Somoco does not vet them, does not check that the judge is
            impartial, and will not compensate you if they get it wrong or act dishonestly.
            Invite people you trust. Somoco can still void a friend market (which only
            refunds), and the 30-day timeout above still applies if everyone goes silent.
          </p>
        </section>

        <section className="legal-section" id="risk">
          <h2 className="legal-h2">10. Risk disclosure</h2>
          <p>
            Read this section even if you skip the rest. Using somoco can cost you everything
            you put in.
          </p>
          <ul>
            <li>
              <strong>You can lose your whole stake.</strong> If you are on the losing side of
              a market, your stake goes to the winners. That is the normal, expected outcome
              for roughly half of all participants.
            </li>
            <li>
              <strong>The smart contracts are new and have not been independently audited.</strong>{' '}
              They have been tested, but testing is not proof. A bug, an exploit, or a flaw we
              have not found could drain or freeze the funds in a market. Do not stake more
              than you can afford to lose entirely.
            </li>
            <li>
              <strong>Somoco is early software.</strong> Expect defects, downtime, wrong
              numbers on screen, failed transactions, and breaking changes.
            </li>
            <li>
              <strong>Resolution risk.</strong> Outcomes are decided by people and by outside
              sources, both of which can be wrong, late, biased, or unavailable.
            </li>
            <li>
              <strong>$TRUST is volatile.</strong> Its value can fall sharply, including
              between the moment you stake and the moment you claim. Winning a market does not
              mean gaining value.
            </li>
            <li>
              <strong>Blockchain risk.</strong> The Intuition network could halt, fork,
              reorganise, become congested, or shut down. Somoco does not control it.
            </li>
            <li>
              <strong>No protection.</strong> There is no deposit insurance, no compensation
              scheme, no regulator standing behind this, and no chargeback. If your funds are
              lost, they are lost.
            </li>
            <li>
              <strong>Nothing here is advice.</strong> Nothing on somoco is financial,
              investment, legal, or tax advice, or a recommendation to stake on anything.
              Odds, trending markets, and leaderboards are information, not guidance.
            </li>
          </ul>
        </section>

        <section className="legal-section" id="conduct">
          <h2 className="legal-h2">11. Acceptable use</h2>
          <p>You must not:</p>
          <ul>
            <li>Use somoco where it is illegal for you, or to break any law.</li>
            <li>
              Stake on an outcome you have inside knowledge of, or that you can influence —
              including any prediction about a person’s death, injury, or misfortune, or one
              you have arranged in advance.
            </li>
            <li>
              Manipulate a market, move odds artificially, or run multiple wallets to game
              leaderboards, reputation scores, eligibility limits, or any incentive somoco
              offers.
            </li>
            <li>
              Attack the contracts or the site — exploiting bugs, front-running, draining
              funds, denial of service, scraping at scale, or bypassing an access gate.
            </li>
            <li>
              Submit content that is illegal, targets or harasses a private individual,
              incites violence, is hate speech, is sexual content involving minors, infringes
              someone’s rights, or is spam.
            </li>
            <li>
              Impersonate somoco or anyone else, or launder money or finance anything
              prohibited.
            </li>
          </ul>
          <p>
            If you break these rules we may remove your content, block your address, and stop
            serving you. We cannot claw back funds already in a contract, and we may report
            unlawful activity to the authorities.
          </p>
        </section>

        <section className="legal-section" id="content">
          <h2 className="legal-h2">12. Your content and moderation</h2>
          <p>
            You keep ownership of what you submit. By submitting it you give somoco a
            worldwide, royalty-free, non-exclusive licence to store, display, reproduce and
            adapt it for the purpose of running and promoting somoco. This licence has to
            survive any account closure, because the claim itself is already on a public
            blockchain and cannot be withdrawn.
          </p>
          <p>
            You confirm that what you submit is yours to submit, including any image you
            attach, and that publishing it breaks no law and infringes nobody’s rights.
          </p>
          <p>
            We review predictions before they appear and may reject or remove anything, with
            or without a reason. We are under no obligation to monitor, and reviewing some
            content does not make us responsible for what we miss. If something here infringes
            your rights, contact us (section 20) and we will remove it from the interface —
            noting again that the on-chain record is beyond anyone’s reach.
          </p>
        </section>

        <section className="legal-section" id="ip">
          <h2 className="legal-h2">13. Intellectual property</h2>
          <p>
            The somoco name, logo, interface, copy and design are ours. These terms give you
            no right to use them beyond using the site normally. The underlying protocols and
            open-source libraries somoco is built on belong to their own authors under their
            own licences.
          </p>
        </section>

        <section className="legal-section" id="privacy">
          <h2 className="legal-h2">14. Privacy and data</h2>
          <p>
            Somoco does not ask for your name, address, or government ID, and does not run
            identity checks. What we hold is:
          </p>
          <ul>
            <li>
              <strong>Your wallet address</strong>, plus a reputation score computed from
              public on-chain activity, and the timestamps of your visits.
            </li>
            <li>
              <strong>Your predictions</strong>, their status, categories, resolution plans and
              any images you upload — stored in somoco’s database and file storage (Supabase).
            </li>
            <li>
              <strong>Your email address</strong>, only if you chose email login, held by Privy
              rather than by us.
            </li>
            <li>
              <strong>Ordinary technical logs</strong> from our hosting provider, such as IP
              address and browser, kept for security and debugging.
            </li>
          </ul>
          <p>
            Prediction text you submit is sent to Anthropic for parsing. Your wallet address
            and every transaction you make are public on the Intuition blockchain by design —
            that is the product, not a leak — and a wallet address is pseudonymous, not
            anonymous. Anyone can link everything one address ever did, and if that address is
            ever tied to your identity, so is your whole history on somoco.
          </p>
          <p>
            We do not sell your data. We share it only with the providers that make somoco run
            (currently Privy for wallets and login, Supabase for the database, Anthropic for
            parsing, and our hosting provider) and where the law requires it.
          </p>
          <p>
            You may ask us what we hold about your address and ask us to delete it, at the
            contact below. We will do that for our own database. We cannot do it for the
            blockchain, and we may keep what we need to for legal or security reasons.
          </p>
        </section>

        <section className="legal-section" id="availability">
          <h2 className="legal-h2">15. Availability and changes</h2>
          <p>
            Somoco is in early access and may run behind an invite code. We do not promise it
            will be available, uninterrupted, or bug-free, and we may change, suspend, or shut
            down any part of it at any time, with or without notice.
          </p>
          <p>
            If somoco shuts down, the smart contracts stay on the blockchain and stay usable
            directly. Markets already open remain governed by their own contract, including
            the 30-day timeout that lets anyone void an unresolved market so stakes can be
            reclaimed.
          </p>
        </section>

        <section className="legal-section" id="disclaimers">
          <h2 className="legal-h2">16. Disclaimers</h2>
          <p>
            Somoco is provided <strong>“as is” and “as available”</strong>, with no warranties
            of any kind, express or implied, including merchantability, fitness for a
            particular purpose, non-infringement, accuracy, or uninterrupted operation, to the
            fullest extent the law allows.
          </p>
          <p>
            We do not warrant that the contracts are free of defects, that AI parsing is
            correct, that odds or balances shown are accurate, that any prediction will
            resolve as you expect, or that any third-party service will keep working.
          </p>
          <p>
            Some countries do not allow these exclusions. If you live in one, you keep
            whatever rights it gives you, and nothing here removes liability that cannot
            lawfully be removed — including for fraud, or for death or personal injury caused
            by our negligence.
          </p>
        </section>

        <section className="legal-section" id="liability">
          <h2 className="legal-h2">17. Limitation of liability</h2>
          <p>
            To the fullest extent the law allows, somoco and the people behind it are not
            liable for lost stakes, lost profits, lost opportunity, lost data, or any
            indirect, incidental, special, consequential or punitive loss, however it arises.
          </p>
          <p>
            This includes losses caused by a smart contract bug or exploit, an incorrect or
            delayed resolution, an AI mis-parse, downtime, a failed or front-run transaction,
            anything a third-party provider does, and anything the Intuition network does.
          </p>
          <p>
            Where liability cannot be excluded, our total liability to you for everything
            connected with somoco is capped at the total fees somoco actually received from
            your activity in the 6 months before the claim, or <Blank>CAP AMOUNT, e.g. US$100</Blank>,
            whichever is greater.
          </p>
        </section>

        <section className="legal-section" id="indemnity">
          <h2 className="legal-h2">18. Indemnity</h2>
          <p>
            If someone brings a claim against us because of how you used somoco — content you
            submitted, rules you broke, laws you broke where you live, or rights of others you
            infringed — you will cover our losses, costs and reasonable legal fees.
          </p>
        </section>

        <section className="legal-section" id="law">
          <h2 className="legal-h2">19. Governing law and disputes</h2>
          <p>
            These terms are governed by the laws of <Blank>JURISDICTION</Blank>, and the
            courts of <Blank>JURISDICTION</Blank> have exclusive jurisdiction over any dispute
            about them — except that the outcome of a resolved market is final and is not
            subject to dispute (section 9).
          </p>
          <p>
            Before starting formal proceedings, please contact us so we can try to sort it out
            directly. Any claim must be brought individually, not as part of a class action.
          </p>
        </section>

        <section className="legal-section" id="contact">
          <h2 className="legal-h2">20. Changes and contact</h2>
          <p>
            We may update these terms. The effective date at the top always shows the current
            version, and continuing to use somoco after a change means you accept it. Changes
            never apply retroactively to a market that has already resolved.
          </p>
          <p>
            If any part of these terms turns out to be unenforceable, the rest still stands.
            Not enforcing something once does not waive it. These terms, plus anything they
            link to, are the whole agreement between us.
          </p>
          <p>
            Contact: <Blank>CONTACT EMAIL</Blank> or{' '}
            <a href="https://x.com/somoco_app" target="_blank" rel="noopener noreferrer">
              @somoco_app
            </a>{' '}
            on X.
          </p>
        </section>
      </div>

      <SiteFooter />
    </div>
  )
}
