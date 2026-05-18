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
            <a className="rmbl-mark" href="https://rmbl.org" target="_blank" rel="noopener noreferrer" aria-label="RMBL">R M B L</a>
            <span className="topbar-sep" aria-hidden="true"></span>
            <a className="topbar-parent" href="https://data.rmbl.org" target="_blank" rel="noopener noreferrer">Data Hub</a>
            <span className="topbar-chev" aria-hidden="true">›</span>
            <Link href="/" className="topbar-current">Knowledge Fabric<span className="ver">v0.2</span></Link>
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
                  <Link href="/frontiers">Frontiers</Link>
                  <Link href="/neighborhoods">Neighborhoods</Link>
                  <Link href="/authors">Authors</Link>
                  <Link href="/species">Species</Link>
                  <Link href="/concepts">Concepts</Link>
                  <Link href="/protocols">Protocols</Link>
                  <Link href="/places">Places</Link>
                  <Link href="/projects">Projects</Link>
                </div>
              </div>
              <Link href="/about">About</Link>
            </nav>
            <ThemeToggle />
          </div>
        </header>
        <main id="main-content">{children}</main>
        <footer className="site-footer">
          <div className="footer-columns">
            <div className="footer-column">
              <h4>Tools</h4>
              <ul>
                <li><a href="https://data.rmbl.org" target="_blank" rel="noopener noreferrer">Data Hub</a></li>
                <li><a href="https://sdpbrowser.org" target="_blank" rel="noopener noreferrer">Spatial Data Platform Browser</a></li>
                <li><a href="https://viewer.synopticdata.com/map/data/now/air-temperature/DRBIL/plots/temperature#map=13.27/38.95105/-106.99211&sort=STID,asc&networks=25,46,62,106,136,2" target="_blank" rel="noopener noreferrer">Weather and Climate Dashboard</a></li>
                <li><a href="https://www.youtube.com/watch?v=qiWEvBqVDps" target="_blank" rel="noopener noreferrer">Gothic webcam</a></li>
                <li><a href="https://gothicwx.org" target="_blank" rel="noopener noreferrer">billy barr&rsquo;s snow records</a></li>
                <li><a href="https://rmbl-sdp.github.io/pySDP/" target="_blank" rel="noopener noreferrer">pySDP</a></li>
                <li><a href="https://rmbl-sdp.github.io/rSDP" target="_blank" rel="noopener noreferrer">rSDP</a></li>
                <li><a href="https://rmblcomputehub.org" target="_blank" rel="noopener noreferrer">RMBL Compute Hub</a></li>
                <li><a href="https://rmblflowercast.org" target="_blank" rel="noopener noreferrer">Bloom Forecast</a></li>
              </ul>
            </div>
            <div className="footer-column">
              <h4>Connect</h4>
              <ul>
                <li><a href="https://github.com/rmbl-sdp" target="_blank" rel="noopener noreferrer">GitHub &middot; rmbl-sdp</a></li>
                <li><a href="https://www.rmbl.org" target="_blank" rel="noopener noreferrer">RMBL main site</a></li>
                <li><a href="mailto:ikb@rmbl.org">ikb@rmbl.org</a></li>
              </ul>
            </div>
          </div>

          <div className="footer-bottom">
            <p className="footer-address">
              <strong>Rocky Mountain Biological Laboratory</strong> &middot; Gothic, Colorado &middot; founded 1928. A non-profit field station for long-term ecological research.
            </p>
            <p className="footer-legal">
              P.O. Box 519 Crested Butte, CO 81224 &middot; (970) 349-7231 &middot; RMBL is a Colorado non-profit organization with IRS 501(c)(3) status. RMBL is an equal opportunity service provider and employer
              and operates under permit from the USDA Forest Service, Gunnison National Forest.
            </p>
            <p className="footer-legal" style={{ marginTop: '8px' }}>
              Support for the Knowledge Fabric provided by the Clark Family Foundation.
            </p>
            <p className="footer-legal" style={{ marginTop: '8px' }}>
              &copy; {new Date().getFullYear()} Rocky Mountain Biological Laboratory &middot; rmblknowledgefabric.org
            </p>
          </div>
        </footer>
      </body>
    </html>
  )
}
