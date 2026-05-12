import React from 'react'
import Link from 'next/link'
import ThemeToggle from './components/ThemeToggle'
import './styles.css'

export const metadata = {
  title: 'RMBL Knowledge Fabric',
  description:
    'Search documents, publications, and datasets from the Rocky Mountain Biological Laboratory and Gunnison Basin.',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light">
      <body>
        <a href="#main-content" className="skip-link">Skip to main content</a>
        <header className="site-header">
          <div className="site-header-inner">
            <Link href="/" className="site-logo">
              <img src="/rmbl-logo.jpg" alt="RMBL" />
              <span className="site-brand-title">
                Knowledge Fabric<span className="site-brand-ver">v0.1</span>
              </span>
            </Link>
            <nav className="site-nav">
              <Link href="/search">Search</Link>
              <div className="nav-dropdown">
                <button className="nav-dropdown-trigger" aria-haspopup="true">Sources</button>
                <div className="nav-dropdown-menu">
                  <Link href="/search?type=publications">Publications</Link>
                  <Link href="/search?type=datasets">Datasets</Link>
                  <Link href="/search?type=documents">Documents</Link>
                  <Link href="/stories">Stories</Link>
                </div>
              </div>
              <div className="nav-dropdown">
                <button className="nav-dropdown-trigger" aria-haspopup="true">Explore</button>
                <div className="nav-dropdown-menu">
                  <Link href="/neighborhoods">Neighborhoods</Link>
                  <Link href="/authors">Authors</Link>
                  <Link href="/species">Species</Link>
                  <Link href="/concepts">Concepts</Link>
                  <Link href="/protocols">Protocols</Link>
                  <Link href="/places">Places</Link>
                  <Link href="/projects">Projects</Link>
                </div>
              </div>
              <div className="nav-dropdown">
                <button className="nav-dropdown-trigger" aria-haspopup="true">Research Tools</button>
                <div className="nav-dropdown-menu">
                  <a href="https://sdpbrowser.org" target="_blank" rel="noopener noreferrer">
                    SDP Browser
                    <span className="nav-dropdown-desc">Geospatial data layers from western Colorado research sites</span>
                  </a>
                  <a href="https://rmblcomputehub.org" target="_blank" rel="noopener noreferrer">
                    RMBL Compute Hub
                    <span className="nav-dropdown-desc">JupyterHub environment for geospatial analysis</span>
                  </a>
                </div>
              </div>
              <Link href="/about">About</Link>
            </nav>
            <ThemeToggle />
          </div>
        </header>
        <main id="main-content">{children}</main>
        <footer className="site-footer">
          <p className="footer-address">
            <strong>Rocky Mountain Biological Laboratory</strong> &bull; P.O. Box 519 Crested Butte, CO 81224 &bull; (970) 349-7231
          </p>
          <p className="footer-legal">
            RMBL is a Colorado non-profit organization with IRS 501(c)(3) status. RMBL is an equal opportunity service provider and employer
            and operates under permit from the USDA Forest Service, Gunnison National Forest.
          </p>
          <p className="footer-legal" style={{ marginTop: '8px' }}>
            Support for the Knowledge Fabric provided by the Clark Family Foundation.
          </p>
        </footer>
      </body>
    </html>
  )
}
