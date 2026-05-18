import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Not found · RMBL Knowledge Fabric',
  robots: { index: false, follow: false },
}

const QUIPS = [
  'This trail isn’t on the map yet.',
  'You’ve wandered off the marked route.',
  'The cairn that pointed here has tipped over.',
  'Nothing in the field notebook at this coordinate.',
  'A marmot has dismantled the engine of this page.',
]

export default function NotFound() {
  const quip = QUIPS[Math.floor(Math.random() * QUIPS.length)]
  return (
    <div className="not-found">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="not-found__marmot"
        src="/marmot-engine.png"
        alt="A marmot perched atop a dismantled engine, holding a horn"
        width={320}
        height={350}
      />
      <h1 className="not-found__title">{quip}</h1>
      <p className="not-found__sub">
        The page you’re looking for either moved, was retired during curation, or was never here to begin with.
        Try searching — there’s a lot of ground to cover.
      </p>
      <div className="not-found__actions">
        <Link href="/search">Search the Fabric</Link>
        <Link href="/">Back to home</Link>
        <Link href="/about">About</Link>
      </div>
    </div>
  )
}
