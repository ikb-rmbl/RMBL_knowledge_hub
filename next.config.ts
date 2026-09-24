import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(__filename)

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // baseline security headers on every route
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      {
        source: '/api/v1/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Cache-Control', value: 'no-store, max-age=0' },
        ],
      },
      // CDN-cache the public browse/explore surface (Sep 2026 botnet
      // defense-in-depth): Vercel-CDN-Cache-Control is honored by Vercel's
      // CDN but never forwarded to browsers, so Next.js's own Cache-Control
      // for dynamic pages is untouched. Entries are keyed per full URL
      // (query string included), so faceted views cache independently and a
      // bare-path flood collapses onto one cached entry instead of invoking
      // functions + Neon per request. Content staleness is bounded at 5 min
      // with background refresh for the following hour.
      ...[
        '/search',
        '/authors',
        '/species',
        '/places',
        '/datasets',
        '/protocols',
        '/concepts',
        '/stories',
        '/neighborhoods',
        '/frontiers',
        '/projects',
        '/eras',
        '/metrics',
        '/about',
        '/documents',
        '/explore/:path*',
      ].map((source) => ({
        source,
        headers: [
          {
            key: 'Vercel-CDN-Cache-Control',
            value: 'public, s-maxage=300, stale-while-revalidate=3600',
          },
        ],
      })),
      // CDN-cache the item detail surface (Sep 2026 botnet round 3). The
      // scrapers moved here once the browse paths above were cached +
      // challenged: detail pages were the only surface that was neither, and
      // every one is `force-dynamic`, so each hit cost a function invocation
      // plus a Neon query. At the time of writing that was ~85% of all
      // invocations (~280K/day) against ~33K distinct URLs, nearly all of it
      // repeat walks of the same list.
      //
      // Longer TTL than the browse paths: detail content only changes when the
      // pipeline runs, so an hour of staleness is cheap, and the day-long
      // stale-while-revalidate means a re-walk is served from the edge even
      // after the TTL lapses. Deliberately NOT paired with a Challenge rule —
      // robots.txt invites ClaudeBot/GPTBot/PerplexityBot and these pages are
      // the canonical indexable content.
      ...[
        '/authors/:id',
        '/publications/:id',
        '/places/:id',
        '/species/:id',
        '/concepts/:id',
        '/documents/:id',
        '/datasets/:id',
        '/protocols/:id',
        '/stories/:id',
        '/projects/:id',
        '/neighborhoods/:id',
        '/frontiers/:id',
        '/eras/:slug',
      ].map((source) => ({
        source,
        headers: [
          {
            key: 'Vercel-CDN-Cache-Control',
            value: 'public, s-maxage=3600, stale-while-revalidate=86400',
          },
        ],
      })),
    ]
  },
  images: {
    localPatterns: [
      {
        pathname: '/api/media/file/**',
      },
    ],
  },
  webpack: (webpackConfig) => {
    webpackConfig.resolve.extensionAlias = {
      '.cjs': ['.cts', '.cjs'],
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    }

    return webpackConfig
  },
  turbopack: {
    root: path.resolve(dirname),
  },
}

export default withPayload(nextConfig, { devBundleServerPackages: false })
