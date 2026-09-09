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
