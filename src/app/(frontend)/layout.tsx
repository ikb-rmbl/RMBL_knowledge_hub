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
              <img src="/rmbl-logo.jpg" alt="RMBL" />
              <span>Knowledge Hub</span>
            </Link>
            <nav className="site-nav">
              <Link href="/search">Search</Link>
              <Link href="/search?type=documents">Documents</Link>
              <Link href="/search?type=publications">Publications</Link>
              <Link href="/search?type=datasets">Datasets</Link>
              <Link href="/authors">Authors</Link>
              <Link href="/projects">Projects</Link>
            </nav>
          </div>
        </header>
        <main>{children}</main>
        <footer className="site-footer">
          <p className="footer-address">
            <strong>Rocky Mountain Biological Laboratory</strong> &bull; P.O. Box 519 Crested Butte, CO 81224 &bull; (970) 349-7231
          </p>
          <p className="footer-legal">
            RMBL is a Colorado non-profit organization with IRS 501(c)(3) status. RMBL is an equal opportunity service provider and employer
            and operates under permit from the USDA Forest Service, Gunnison National Forest.
          </p>
          <p className="footer-legal" style={{ marginTop: '8px' }}>
            Support for the Knowledge Hub provided by the Clark Family Foundation.
          </p>
        </footer>
      </body>
    </html>
  )
}
