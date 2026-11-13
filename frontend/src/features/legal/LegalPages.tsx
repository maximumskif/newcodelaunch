import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { LEGAL_CONTACT, LEGAL_REVIEWED, LEGAL_UPDATED, OPERATOR_NAME } from './legal'

// Terms, Privacy and Risks (docs/RELEASE_CHECKLIST.md, item 13). Every claim
// here should match what the code does; change both together. The fees come
// from the curve and NFT templates (see docs/REBUILD_PROGRESS.md, "Fees").

const operator = OPERATOR_NAME || 'the operator of this site'

function Contact() {
  if (!LEGAL_CONTACT) return <>through the contact details that will be listed here before launch</>
  if (LEGAL_CONTACT.includes('@')) return <a href={`mailto:${LEGAL_CONTACT}`} className="text-accent-400 underline underline-offset-2">{LEGAL_CONTACT}</a>
  return <>{LEGAL_CONTACT}</>
}

function LegalLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="mx-auto max-w-3xl space-y-6 px-4 py-10 text-sm leading-relaxed text-ink-muted sm:px-6">
      <header className="space-y-2">
        <h1 className="font-display text-2xl font-semibold text-ink">{title}</h1>
        <p className="text-xs text-ink-faint">Last updated {LEGAL_UPDATED}</p>
      </header>
      {!LEGAL_REVIEWED && (
        <p role="note" className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs" data-testid="legal-draft">
          <span className="font-medium text-ink">Draft.</span> This page describes how the site works today but hasn&apos;t been reviewed by a lawyer yet.
        </p>
      )}
      {children}
      <footer className="border-t border-border pt-4 text-xs text-ink-faint">
        See also: <Link to="/terms" className="underline underline-offset-2 hover:text-ink">Terms</Link> · <Link to="/privacy" className="underline underline-offset-2 hover:text-ink">Privacy</Link> ·{' '}
        <Link to="/risks" className="underline underline-offset-2 hover:text-ink">Risks</Link>
      </footer>
    </article>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="font-display text-base font-semibold text-ink">{title}</h2>
      {children}
    </section>
  )
}

export function TermsPage() {
  return (
    <LegalLayout title="Terms of use">
      <Section title="What this site is">
        <p>
          NewCodeLaunch, run by {operator}, is a set of tools for creating tokens, NFT collections, bonding-curve launches, airdrops, vesting and
          other on-chain contracts. The site prepares transactions; you review and sign every one of them in your own wallet. We never hold your
          private keys or seed phrase and can&apos;t move your funds.
        </p>
      </Section>
      <Section title="Your responsibility">
        <ul className="list-disc space-y-1 pl-5">
          <li>You&apos;re responsible for what you create and launch, and for following the laws that apply to you, including securities, tax and consumer rules.</li>
          <li>Check every transaction in your wallet before you sign it. Transactions on a blockchain are final; we can&apos;t reverse or refund them.</li>
          <li>Try things on a test network first. Mainnet launches cost real money.</li>
          <li>Don&apos;t use the site for fraud, to impersonate others, to infringe anyone&apos;s rights, or for anything illegal where you or your buyers are.</li>
        </ul>
      </Section>
      <Section title="Fees">
        <p>Using the tools is free apart from the network&apos;s own fees (gas), with two exceptions:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Bonding curves: every buy and sell on a curve pays 1% of the trade, 0.7% to the platform and 0.3% to the token&apos;s creator. Trades on a DEX after graduation pay no platform fee.</li>
          <li>NFT drops on Solana: each mint pays the platform 0.01 SOL, on top of the drop&apos;s own price.</li>
        </ul>
        <p>These fees are written into the contracts and are shown before you sign.</p>
      </Section>
      <Section title="No advice, no guarantees">
        <p>
          Nothing on the site is financial, legal or tax advice. Market data, token checks and holder snapshots come from third parties and public
          blockchains and can be wrong, late or incomplete. The site and its contracts are provided as they are, without warranties. To the extent
          the law allows, {operator} isn&apos;t liable for losses from using the site, its contracts or tokens created with it. Read the{' '}
          <Link to="/risks" className="text-accent-400 underline underline-offset-2">risk disclosure</Link> before you put money in.
        </p>
      </Section>
      <Section title="Content you publish">
        <p>
          Token names, images, NFT art and metadata you upload may be stored on IPFS, which is public and effectively permanent, and new launches may
          be announced on the platform&apos;s Telegram channel and X account. Only upload what you have the right to publish. We may hide pages for
          tokens or drops that break these terms; we can&apos;t remove anything from a blockchain or from IPFS.
        </p>
      </Section>
      <Section title="Changes and contact">
        <p>
          We may update these terms; the date above shows the latest version. Questions: <Contact />.
        </p>
      </Section>
    </LegalLayout>
  )
}

export function PrivacyPage() {
  return (
    <LegalLayout title="Privacy">
      <Section title="What we store">
        <ul className="list-disc space-y-1 pl-5">
          <li>Your wallet addresses, when you sign in by signing a message with your wallet. There are no passwords, names or email addresses.</li>
          <li>What you create while signed in: projects, token and contract settings, deployments, NFT layers and traits, and the images you upload.</li>
          <li>Server logs, which include IP addresses, pages requested and errors. They&apos;re used to run and secure the site, including rate limits.</li>
        </ul>
        <p>We don&apos;t use advertising or analytics trackers, and we don&apos;t sell data.</p>
      </Section>
      <Section title="In your browser">
        <p>
          The site keeps your sign-in session and a few display settings (such as the collapsed sidebar) in your browser&apos;s local storage. Signing
          out removes the session. There are no tracking cookies.
        </p>
      </Section>
      <Section title="Public by nature">
        <p>
          Anything you do on a blockchain (your address, your transactions, the contracts and tokens you create) is public and permanent, and isn&apos;t
          controlled by us. The same goes for files published to IPFS. New launches may be posted to the platform&apos;s Telegram channel and X account.
        </p>
      </Section>
      <Section title="Services we rely on">
        <p>To work, the site sends some requests to other providers, under their own privacy policies:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Blockchain RPC providers (such as Helius and public network endpoints), to read and send transactions.</li>
          <li>Pinata, to publish images and metadata to IPFS.</li>
          <li>Etherscan, to verify contract source code.</li>
          <li>CoinGecko, DexScreener and DefiLlama, for market data.</li>
          <li>WalletConnect (Reown), if you connect a phone wallet that way.</li>
          <li>Telegram and X, to announce launches.</li>
        </ul>
      </Section>
      <Section title="Your choices">
        <p>
          To have your account and what you&apos;ve stored with us deleted, or to ask what we hold about your wallet, contact us: <Contact />. We can delete
          what&apos;s in our database and logs, but not what&apos;s on a blockchain or IPFS. Backups are kept for up to 14 days.
        </p>
      </Section>
    </LegalLayout>
  )
}

export function RisksPage() {
  return (
    <LegalLayout title="Risk disclosure">
      <p>
        Crypto tokens and NFTs are highly risky. Most new tokens lose most or all of their value. Only put in what you can afford to lose entirely.
      </p>
      <Section title="The contracts aren't audited">
        <p>
          The contracts this site deploys, the bonding curve included, haven&apos;t been independently audited. Until a curve graduates, it holds the
          coins its buyers pay in, and a bug in its code could lose them with no way to get them back.
        </p>
      </Section>
      <Section title="Bonding curves">
        <ul className="list-disc space-y-1 pl-5">
          <li>The price moves with every trade. Buying early doesn&apos;t mean you can sell later at a profit, or at all if others are selling.</li>
          <li>Every buy and sell pays a 1% fee (0.7% to the platform, 0.3% to the creator), so a buy followed by a sell loses at least 2%.</li>
          <li>A curve may never reach graduation. After graduation, trading moves to a DEX pool, where prices and liquidity are set by the market.</li>
        </ul>
      </Section>
      <Section title="Tokens anyone can create">
        <p>
          Anyone can launch a token here, including people who mean to deceive. A creator can sell their own holdings, and token settings (taxes,
          limits, ownership) vary by template. Use the token checker, read the token&apos;s page and its contract, and don&apos;t trust names, logos or
          social links, which anyone can copy.
        </p>
      </Section>
      <Section title="Transactions are final">
        <p>
          Blockchain transactions can&apos;t be undone. Sending to the wrong address, signing a malicious transaction or losing your keys means losing
          the funds. Networks can be congested, fees can spike, and transactions can fail and still cost gas.
        </p>
      </Section>
      <Section title="Rules where you live">
        <p>
          Tokens and NFTs may be regulated, restricted or taxed where you or your buyers live. Checking that is your responsibility. See the{' '}
          <Link to="/terms" className="text-accent-400 underline underline-offset-2">terms</Link>.
        </p>
      </Section>
    </LegalLayout>
  )
}
