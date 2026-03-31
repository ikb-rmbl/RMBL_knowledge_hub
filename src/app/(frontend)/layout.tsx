import React from 'react'
import Link from 'next/link'
import './styles.css'

export const metadata = {
  title: 'RMBL Knowledge Hub',
  description:
    'Search documents, publications, and datasets from the Rocky Mountain Biological Laboratory and Gunnison Basin.',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="site-header-inner">
            <Link href="/" className="site-logo">
              RMBL Knowledge Hub
            </Link>
            <nav className="site-nav">
              <Link href="/search">Search</Link>
              <Link href="/search?type=documents">Documents</Link>
              <Link href="/search?type=publications">Publications</Link>
              <Link href="/search?type=datasets">Datasets</Link>
            </nav>
          </div>
        </header>
        <main>{children}</main>
        <footer className="site-footer">
          Rocky Mountain Biological Laboratory &middot; Gothic, Colorado
        </footer>
      </body>
    </html>
  )
}
