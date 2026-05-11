import { postgresAdapter } from '@payloadcms/db-postgres'
import { s3Storage } from '@payloadcms/storage-s3'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

import { Users } from './collections/Users'
import { Media } from './collections/Media'
import { Documents } from './collections/Documents'
import { Publications } from './collections/Publications'
import { Datasets } from './collections/Datasets'
import { Topics } from './collections/Topics'
import { Authors } from './collections/Authors'
import { Projects } from './collections/Projects'
import { Species } from './collections/Species'
import { Places } from './collections/Places'
import { Protocols } from './collections/Protocols'
import { Concepts } from './collections/Concepts'
import { Stories } from './collections/Stories'
import { Flags } from './collections/Flags'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

// ---------------------------------------------------------------------------
// Environment validation
// ---------------------------------------------------------------------------

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required')
}
const minSecretLength = process.env.NODE_ENV === 'production' ? 32 : 16
if (!process.env.PAYLOAD_SECRET || process.env.PAYLOAD_SECRET.length < minSecretLength) {
  throw new Error(`PAYLOAD_SECRET must be at least ${minSecretLength} characters`)
}

// ---------------------------------------------------------------------------
// S3 storage plugin (conditional — only enabled when S3_BUCKET is set)
// ---------------------------------------------------------------------------

const s3Configured = process.env.S3_BUCKET && process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY
const plugins = s3Configured
  ? [
      s3Storage({
        collections: { media: true },
        bucket: process.env.S3_BUCKET!,
        config: {
          credentials: {
            accessKeyId: process.env.S3_ACCESS_KEY!,
            secretAccessKey: process.env.S3_SECRET_KEY!,
          },
          region: process.env.S3_REGION || 'auto',
          ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
        },
      }),
    ]
  : []

// ---------------------------------------------------------------------------
// Payload CMS configuration
// ---------------------------------------------------------------------------

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [Users, Media, Documents, Publications, Datasets, Topics, Authors, Projects, Species, Places, Protocols, Concepts, Stories, Flags],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET,
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: postgresAdapter({
    pool: {
      connectionString: process.env.DATABASE_URL,
    },
    push: false, // Don't auto-push schema changes (preserves custom tsvector, embeddings, etc.)
  }),
  sharp,
  plugins,
})
